import OpenAI from "openai";
import type { Response } from "openai/resources/responses/responses";
import { SYSTEM_PROMPT } from "./prompt.js";
import { phuketDateTimeContext } from "./time.js";

export const OPENAI_TIMEOUT_MS = 25_000;

export interface AnswerResult {
  text: string;
  usedWebSearch: boolean;
  sources: string[];
  sourceCount: number;
}

export interface ResponsesClient {
  responses: { create(params: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<Response> };
}

const TRACKING_PARAMS = new Set(["fbclid", "gclid", "yclid", "ref", "referrer", "source"]);

export function normalizeSourceUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_") || TRACKING_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase();
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return value.trim();
  }
}

interface SourceReference { url: string; title?: string }

function sourceReferences(response: Response): { cited: SourceReference[]; searched: SourceReference[] } {
  const cited: SourceReference[] = [];
  const searched: SourceReference[] = [];
  for (const item of response.output) {
    if (item.type === "web_search_call" && item.action.type === "search") {
      for (const source of item.action.sources ?? []) searched.push({ url: source.url });
    }
    if (item.type !== "message") continue;
    for (const content of item.content) {
      if (content.type !== "output_text") continue;
      for (const annotation of content.annotations) {
        if (annotation.type === "url_citation") cited.push({ url: annotation.url, title: annotation.title });
      }
    }
  }
  return { cited, searched };
}

function deduplicateSources(sources: SourceReference[]): SourceReference[] {
  return [...new Map(sources.map((source) => {
    const url = normalizeSourceUrl(source.url);
    return [url, { ...source, url }];
  })).values()];
}

export function deduplicateParagraphs(text: string): string {
  const seen = new Set<string>();
  return text.trim().split(/\n\s*\n/).filter((paragraph) => {
    const key = paragraph
      .replace(/https?:\/\/\S+/g, "")
      .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
      .replace(/\s+/g, " ").trim().toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join("\n\n");
}

/** Final safety gate for model-produced open-now lists. Venue blocks must carry a verified marker. */
export function filterOpenNowAnswer(text: string, fallback: string): string {
  const blocks = text.trim().split(/\n\s*\n/);
  const verified = blocks.filter((block) => /\[STATUS:OPEN]/i.test(block)).slice(0, 5);
  if (!verified.length) return fallback.trim();
  const intro = blocks.find((block) => !/\[STATUS:(?:OPEN|CLOSED|UNKNOWN)]/i.test(block));
  return [intro, ...verified].filter(Boolean).join("\n\n").replace(/\s*\[STATUS:OPEN]\s*/gi, "").trim();
}

/** Runs one Responses API request and lets the model decide whether search is needed. */
export async function generateAnswer(client: ResponsesClient, model: string, question: string): Promise<AnswerResult> {
  const signal = AbortSignal.timeout(OPENAI_TIMEOUT_MS);
  let response: Response;
  try {
    response = await client.responses.create({
      model,
      instructions: `${SYSTEM_PROMPT}\n\nThe language of THIS user message is authoritative; ignore the language of earlier turns. ${phuketDateTimeContext()}.`,
      input: question,
      tools: [{ type: "web_search", external_web_access: true, search_context_size: "medium", user_location: { type: "approximate", city: "Phuket", region: "Phuket", country: "TH", timezone: "Asia/Bangkok" } }],
      tool_choice: "auto",
      include: ["web_search_call.action.sources"],
      max_output_tokens: 900,
    }, { signal });
  } catch (error) {
    throw error;
  }
  const usedWebSearch = response.output.some((item) => item.type === "web_search_call");
  const rawSources = sourceReferences(response);
  const evidenceSources = rawSources.cited.length ? rawSources.cited : rawSources.searched;
  const uniqueSources = deduplicateSources(evidenceSources);
  const sources = uniqueSources.map((source) => source.url);
  const text = deduplicateParagraphs(response.output_text);
  if (!text.trim()) throw new Error("OpenAI returned an empty response");
  return {
    text,
    usedWebSearch,
    sources,
    sourceCount: evidenceSources.length,
  };
}

export function createAnswerGenerator(apiKey: string, model: string) {
  const client = new OpenAI({ apiKey, timeout: OPENAI_TIMEOUT_MS, maxRetries: 1 });
  return (question: string): Promise<AnswerResult> => generateAnswer(client, model, question);
}
