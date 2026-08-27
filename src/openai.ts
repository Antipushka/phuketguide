import OpenAI from "openai";
import type { Response } from "openai/resources/responses/responses";
import { SYSTEM_PROMPT } from "./prompt.js";
import { getPhuketDateTime, phuketDateTimeContext } from "./time.js";
import { removeHistoricalWeatherBlock } from "./rendering.js";

export const OPENAI_TIMEOUT_MS = 25_000;

export interface AnswerResult {
  text: string;
  usedWebSearch: boolean;
  sources: string[];
  sourceCount: number;
  freshnessSensitiveQuery: boolean;
  freshnessWarning: boolean;
}

export interface ResponsesClient {
  responses: { create(params: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<Response> };
}

const TRACKING_PARAMS = new Set(["fbclid", "gclid", "yclid", "ref", "referrer", "source"]);

interface FreshnessRoute {
  freshness_sensitive: boolean;
  fallback: string;
  open_now?: boolean;
  current_weather?: boolean;
}

class LocalizedAnswerError extends Error {
  readonly localizedFallback: string;

  constructor(cause: unknown, localizedFallback: string) {
    super(cause instanceof Error ? cause.message : "OpenAI request failed", { cause });
    this.name = cause instanceof Error ? cause.name : "OpenAIError";
    this.localizedFallback = localizedFallback;
  }
}

async function classifyFreshness(client: ResponsesClient, model: string, question: string, signal: AbortSignal): Promise<FreshnessRoute> {
  const response = await client.responses.create({
    model,
    instructions: `Classify semantically whether the user's request requires current or recently changing information (for example live weather, today's hours/events, current price/rate/status/availability). This must work for every language you understand; do not use keyword matching. Historical, seasonal, explanatory, and general advice questions are not freshness-sensitive. Also write one short fallback sentence in the user's language saying that sufficiently fresh information could not be confirmed and archived data will not be presented as current. Preserve proper nouns. Set open_now only when the user explicitly asks what is open at this moment (not merely today). Set current_weather only for a current weather observation.`,
    input: question,
    text: {
      format: {
        type: "json_schema",
        name: "freshness_route",
        strict: true,
        schema: {
          type: "object",
          properties: {
            freshness_sensitive: { type: "boolean" },
            fallback: { type: "string" },
            open_now: { type: "boolean" },
            current_weather: { type: "boolean" },
          },
          required: ["freshness_sensitive", "fallback", "open_now", "current_weather"],
          additionalProperties: false,
        },
      },
    },
    max_output_tokens: 100,
  }, { signal });
  const route = JSON.parse(response.output_text) as FreshnessRoute;
  if (typeof route.freshness_sensitive !== "boolean" || typeof route.fallback !== "string" || !route.fallback.trim()) {
    throw new Error("OpenAI returned an invalid freshness route");
  }
  return route;
}

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

function looksHistorical(source: SourceReference, currentYear: number): boolean {
  const decoded = decodeURIComponent(`${source.url} ${source.title ?? ""}`).toLowerCase();
  if (/(?:archive|histor(?:y|ical)|climate|monthly|past-weather|weather-average|average-weather)/.test(decoded)) return true;
  const years = decoded.match(/(?:19|20)\d{2}/g)?.map(Number) ?? [];
  return years.some((year) => year < currentYear);
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
  // One shared deadline covers both the semantic router and the answer/search call.
  const signal = AbortSignal.timeout(OPENAI_TIMEOUT_MS);
  const route = await classifyFreshness(client, model, question, signal);
  const freshnessSensitiveQuery = route.freshness_sensitive;
  const local = getPhuketDateTime();
  const today = local.date;
  let response: Response;
  try {
    response = await client.responses.create({
      model,
      instructions: `${SYSTEM_PROMPT}\n\nThe language of THIS user message is authoritative; ignore the language of earlier turns. ${phuketDateTimeContext()}. ${freshnessSensitiveQuery ? "Запрос зависит от свежести: сформулируй поисковый запрос с now/today и текущей датой; не используй архив как подтверждение текущего состояния." : ""} ${route.open_now ? "OPEN NOW MODE: recommend only businesses whose published weekday-specific hours prove they are OPEN at the supplied Phuket time. Correctly evaluate overnight intervals. Exclude CLOSED, UNKNOWN, ambiguous, and merely open-today businesses. Return no more than 5; if few are verified, return only those. Never label an unverified place open. Put every venue in one separate paragraph ending exactly [STATUS:OPEN]; this private marker is mandatory and will be removed before delivery. Do not mark a venue unless its status is proven." : ""} ${route.current_weather ? "CURRENT WEATHER MODE: give one concise current observation or the freshness fallback. Never append climate averages, historical, archive, or source-dump sections." : ""}`,
      input: question,
      tools: [{ type: "web_search", external_web_access: true, search_context_size: "medium", user_location: { type: "approximate", city: "Phuket", region: "Phuket", country: "TH", timezone: "Asia/Bangkok" } }],
      tool_choice: freshnessSensitiveQuery ? "required" : "auto",
      include: ["web_search_call.action.sources"],
      max_output_tokens: 900,
    }, { signal });
  } catch (error) {
    throw new LocalizedAnswerError(error, route.fallback.trim());
  }
  const usedWebSearch = response.output.some((item) => item.type === "web_search_call");
  const rawSources = sourceReferences(response);
  const evidenceSources = rawSources.cited.length ? rawSources.cited : rawSources.searched;
  const uniqueSources = deduplicateSources(evidenceSources);
  const sources = uniqueSources.map((source) => source.url);
  const freshnessWarning = freshnessSensitiveQuery && (!usedWebSearch || uniqueSources.length === 0 || uniqueSources.every((source) => looksHistorical(source, Number(today.slice(0, 4)))));
  const weatherCleaned = route.current_weather ? removeHistoricalWeatherBlock(response.output_text) : response.output_text;
  const cleaned = route.open_now ? filterOpenNowAnswer(weatherCleaned, route.fallback) : weatherCleaned;
  const text = freshnessWarning ? route.fallback.trim() : deduplicateParagraphs(cleaned);
  if (!text.trim()) throw new Error("OpenAI returned an empty response");
  return {
    text,
    usedWebSearch,
    sources,
    sourceCount: evidenceSources.length,
    freshnessSensitiveQuery,
    freshnessWarning,
  };
}

export function createAnswerGenerator(apiKey: string, model: string) {
  const client = new OpenAI({ apiKey, timeout: OPENAI_TIMEOUT_MS, maxRetries: 1 });
  return (question: string): Promise<AnswerResult> => generateAnswer(client, model, question);
}
