import OpenAI from "openai";
import type { Response } from "openai/resources/responses/responses";
import { SYSTEM_PROMPT } from "./prompt.js";
import { getPhuketDateTime, phuketDateTimeContext } from "./time.js";
import { routeResponseKind } from "./responses/router.js";
import { PLOY_RESPONSE_SCHEMA } from "./responses/schema.js";
import { localizedSafeFallback, validateStructuredResponse } from "./responses/validate.js";
import type { StructuredResponse } from "./responses/types.js";
import { assessFreshness, isHistoricalReference, type FreshnessConfidence, type FreshnessRequirement } from "./freshness.js";

export const OPENAI_TIMEOUT_MS = 25_000;

export interface AnswerResult {
  text: string;
  usedWebSearch: boolean;
  sources: string[];
  sourceCount: number;
  freshnessSensitiveQuery: boolean;
  freshnessWarning: boolean;
  freshnessRequirement: FreshnessRequirement;
  freshnessConfidence: FreshnessConfidence;
  realtimeEvidenceType: "none" | "webpage" | "web_search_tool";
  webpageSourceCount: number;
  realtimeToolEvidencePresent: boolean;
  freshnessWarningReason: "none" | "no_search" | "no_realtime_evidence" | "historical_only";
  structured?: StructuredResponse;
  structuredResponseValid: boolean;
}

export interface ResponsesClient {
  responses: { create(params: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<Response> };
}

const TRACKING_PARAMS = new Set(["fbclid", "gclid", "yclid", "ref", "referrer", "source"]);

interface FreshnessRoute {
  requirement: FreshnessRequirement;
  fallback: string;
  open_now?: boolean;
  current_weather?: boolean;
  response_kind?: string;
}

interface LegacyFreshnessRoute extends Partial<FreshnessRoute> { freshness_sensitive?: boolean }

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
    instructions: `Classify the information need semantically in any language, never by keyword alone. requirement=realtime only for a claim about the state right now/today (live weather, exact current rate, open now, today's event or availability); requirement=current for changeable business information such as hours, menus, contacts, prices, rentals, venue details and recommendations; requirement=stable for comparisons, area/beach character, sights and general advice. An unqualified weather question (for example "Какая погода?", "Что с погодой?", "How's the weather?", or a Thai equivalent) means current weather in Phuket: set response_kind=weather, requirement=realtime and current_weather=true without asking a clarification. Phuket is the default location unless the user names another one. Write one short fallback in the user's language for the realtime claim only. Preserve proper nouns. Set open_now only when explicitly asking what is open at this moment.`,
    input: question,
    text: {
      format: {
        type: "json_schema",
        name: "freshness_route",
        strict: true,
        schema: {
          type: "object",
          properties: {
            requirement: { type: "string", enum: ["realtime", "current", "stable"] },
            fallback: { type: "string" },
            open_now: { type: "boolean" },
            current_weather: { type: "boolean" },
            response_kind: { type: "string", enum: ["places_list", "place_detail", "weather", "events", "rate", "rental_list", "property_list", "area_recommendation", "comparison", "itinerary", "general"] },
          },
          required: ["requirement", "fallback", "open_now", "current_weather", "response_kind"],
          additionalProperties: false,
        },
      },
    },
    max_output_tokens: 100,
  }, { signal });
  const raw = JSON.parse(response.output_text) as LegacyFreshnessRoute;
  // Compatibility is useful for in-flight responses during deployment and old test fixtures.
  const route = { ...raw, requirement: raw.requirement ?? (raw.freshness_sensitive ? "realtime" : "stable") } as FreshnessRoute;
  if (!["realtime", "current", "stable"].includes(route.requirement) || typeof route.fallback !== "string" || !route.fallback.trim()) {
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

/** The SDK exposes live web grounding as a completed web_search_call; sources are optional. */
function completedWebSearch(response: Response): boolean {
  return response.output.some((item) => item.type === "web_search_call" && item.status === "completed");
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
  // One shared deadline covers both the semantic router and the answer/search call.
  const signal = AbortSignal.timeout(OPENAI_TIMEOUT_MS);
  const route = await classifyFreshness(client, model, question, signal);
  const responseKind = route.response_kind || routeResponseKind(question);
  const freshnessSensitiveQuery = route.requirement !== "stable";
  const local = getPhuketDateTime();
  const today = local.date;
  let response: Response;
  try {
    response = await client.responses.create({
      model,
      instructions: `${SYSTEM_PROMPT}\n\nThe language of THIS user message is authoritative; ignore earlier turns. ${phuketDateTimeContext()}. Freshness requirement: ${route.requirement}. Return a structured ${responseKind} response, never HTML, Markdown, citations, source lists, confidence metadata, clarifying questions, or Telegram objects. Use language ru, en, th, or other for this message. Give the best reliable answer; an undated official active page is usable and is not stale merely because it has no publication date. Prefer authority and relevance, note a material uncertainty at most once, and preserve every useful part of an answer even when an exact live value cannot be established. Never present archives or historical averages as current. Lists contain 2–5 items and every recommendation item has a specific reason_to_choose. Link fields are only map_url, website_url, or instagram_url and must identify the exact official place. ${freshnessSensitiveQuery ? "Search for relevant evidence; for realtime claims include now/today and the current date." : "Freshness must not block this stable answer."} ${route.open_now ? "OPEN NOW MODE: derive status against the supplied Phuket weekday/time from a reliable published schedule (an official schedule need not have a publication date). Conflicting schedules mean unknown. Include only confirmed open venues; exclude closed or unknown and cap at 5." : ""} ${route.current_weather ? "CURRENT WEATHER MODE: the user means current Phuket weather when no location or period was stated. Search now and answer directly; do not ask what time or location they mean. Return current conditions and at most a short today_summary unless a forecast was requested. If unavailable, use the freshness fallback and do not substitute climate/history." : ""}`,
      input: question,
      tools: [{ type: "web_search", external_web_access: true, search_context_size: "medium", user_location: { type: "approximate", city: "Phuket", region: "Phuket", country: "TH", timezone: "Asia/Bangkok" } }],
      tool_choice: freshnessSensitiveQuery ? "required" : "auto",
      include: ["web_search_call.action.sources"],
      text: { format: { type: "json_schema", name: "ploy_response", strict: true, schema: PLOY_RESPONSE_SCHEMA } },
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
  const evidence = uniqueSources.map((source) => ({ authority: "editorial" as const, historical: isHistoricalReference(source.url, source.title, Number(today.slice(0, 4))) }));
  const assessment = assessFreshness(route.requirement, evidence);
  let parsed: unknown;
  try { parsed = JSON.parse(response.output_text); } catch { parsed = undefined; }
  const validated = validateStructuredResponse(parsed);
  const allWebpagesHistorical = uniqueSources.length > 0 && evidence.every((source) => source.historical);
  // In the current SDK there is no separate weather output item. A completed
  // web_search_call is the documented tool evidence; its URL sources are optional.
  const realtimeToolEvidencePresent = Boolean(route.current_weather && validated?.kind === "weather" && completedWebSearch(response) && uniqueSources.length === 0);
  const hasRealtimeEvidence = assessment.canAnswer || realtimeToolEvidencePresent;
  const freshnessWarningReason = route.requirement !== "realtime" || hasRealtimeEvidence
    ? "none"
    : !usedWebSearch ? "no_search" : allWebpagesHistorical ? "historical_only" : "no_realtime_evidence";
  const freshnessWarning = freshnessWarningReason !== "none";
  const realtimeEvidenceType = realtimeToolEvidencePresent ? "web_search_tool" : assessment.canAnswer && uniqueSources.length ? "webpage" : "none";
  const fallbackStructured: StructuredResponse = { kind: "freshness_fallback", language: "other", heading: route.fallback.trim(), explanation: route.fallback.trim() };
  const safeFallback = localizedSafeFallback(question);
  let structured = freshnessWarning ? fallbackStructured : (validated ?? safeFallback);
  if (route.open_now && structured.kind === "places_list") {
    structured = { ...structured, items: structured.items.filter((item) => item.open_status === "open").slice(0, 5) };
  }
  // output_text is transport only in structured mode. It is never user-facing.
  const text = freshnessWarning ? route.fallback.trim() : safeFallback.explanation;
  if (!text.trim()) throw new Error("OpenAI returned an empty response");
  return {
    text,
    usedWebSearch,
    sources,
    sourceCount: evidenceSources.length,
    freshnessSensitiveQuery,
    freshnessWarning,
    freshnessRequirement: route.requirement,
    freshnessConfidence: assessment.confidence,
    realtimeEvidenceType,
    webpageSourceCount: uniqueSources.length,
    realtimeToolEvidencePresent,
    freshnessWarningReason,
    structured,
    structuredResponseValid: Boolean(validated),
  };
}

export function createAnswerGenerator(apiKey: string, model: string) {
  const client = new OpenAI({ apiKey, timeout: OPENAI_TIMEOUT_MS, maxRetries: 1 });
  return (question: string): Promise<AnswerResult> => generateAnswer(client, model, question);
}
