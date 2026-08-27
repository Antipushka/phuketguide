import type { StructuredResponse, ResponseKind, Language, FreshnessFallback } from "./types.js";

const KINDS = new Set<ResponseKind>(["places_list", "place_detail", "weather", "events", "rate", "rental_list", "property_list", "area_recommendation", "comparison", "itinerary", "general", "freshness_fallback"]);
const LANGUAGES = new Set<Language>(["ru", "en", "th", "other"]);
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && Boolean(value.trim());
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(text);

function sanitizeUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return;
    return url.toString();
  } catch { return; }
}

function clean<T extends Record<string, unknown>>(source: T): T {
  const result: Record<string, unknown> = { ...source };
  for (const key of ["map_url", "website_url", "instagram_url"] as const) {
    const valid = sanitizeUrl(result[key]);
    if (valid) result[key] = valid; else delete result[key];
  }
  for (const [key, value] of Object.entries(result)) if (value === null) delete result[key];
  return result as T;
}

function items(value: unknown, check: (item: Record<string, unknown>) => boolean): Record<string, unknown>[] | undefined {
  if (!Array.isArray(value)) return;
  const cleaned = value.map((item) => record(item) ? clean(item) : item);
  return cleaned.every((item) => record(item) && check(item)) ? cleaned as Record<string, unknown>[] : undefined;
}

/** Runtime boundary: returns a sanitized typed value, never a partially valid payload. */
export function validateStructuredResponse(value: unknown): StructuredResponse | undefined {
  if (!record(value) || !KINDS.has(value.kind as ResponseKind) || !LANGUAGES.has(value.language as Language)) return;
  const v = clean(value);
  let list: Record<string, unknown>[] | undefined;
  switch (v.kind) {
    case "places_list":
      list = items(v.items, (x) => text(x.name) && text(x.reason_to_choose));
      if (!text(v.heading) || !list) return; v.items = list; break;
    case "place_detail": if (!text(v.name) || !text(v.summary)) return; break;
    case "weather":
      if (!text(v.heading) || !text(v.temperature) || !text(v.condition)) return;
      if (v.forecast !== undefined && !items(v.forecast, (x) => text(x.day) && text(x.temperature) && text(x.condition))) return;
      break;
    case "events": list = items(v.items, (x) => text(x.name) && text(x.summary)); if (!text(v.heading) || !list) return; v.items = list; break;
    case "rate": list = items(v.items, (x) => text(x.name) && text(x.pair)); if (!text(v.heading) || !list) return; v.items = list; break;
    case "rental_list": list = items(v.items, (x) => text(x.name) && text(x.vehicle) && text(x.reason_to_choose)); if (!text(v.heading) || !list) return; v.items = list; break;
    case "property_list": list = items(v.items, (x) => text(x.name) && text(x.reason_to_choose)); if (!text(v.heading) || !list) return; v.items = list; break;
    case "area_recommendation": list = items(v.areas, (x) => text(x.name) && strings(x.pros) && strings(x.cons)); if (!text(v.heading) || !list) return; v.areas = list; break;
    case "comparison": list = items(v.options, (x) => text(x.name) && strings(x.points)); if (!text(v.heading) || !list) return; v.options = list; break;
    case "itinerary": list = items(v.stops, (x) => text(x.name) && text(x.description)); if (!text(v.heading) || !list) return; v.stops = list; break;
    case "general": if (!strings(v.paragraphs)) return; break;
    case "freshness_fallback": if (!text(v.heading) || !text(v.explanation)) return; break;
  }
  return v as unknown as StructuredResponse;
}

export function localizedSafeFallback(question: string): FreshnessFallback {
  if (/[а-яё]/i.test(question)) return { kind: "freshness_fallback", language: "ru", heading: "Не удалось подготовить ответ", explanation: "Сейчас не получилось получить надёжный ответ. Попробуй ещё раз через минуту." };
  if (/[฀-๿]/.test(question)) return { kind: "freshness_fallback", language: "th", heading: "ไม่สามารถเตรียมคำตอบได้", explanation: "ขณะนี้ไม่สามารถรับคำตอบที่เชื่อถือได้ โปรดลองอีกครั้งในอีกสักครู่" };
  return { kind: "freshness_fallback", language: "en", heading: "I couldn't prepare an answer", explanation: "I couldn't get a reliable answer right now. Please try again in a minute." };
}

export function safeGeneral(textValue: string, language: Language = "other"): StructuredResponse {
  const cleanText = textValue.replace(/\[[^\]]+\]\(https?:\/\/[^)]+\)/g, "$1").replace(/https?:\/\/\S+/g, "").replace(/^#{1,6}\s*/gm, "").replace(/\*\*/g, "").trim();
  return { kind: "general", language, paragraphs: cleanText.split(/\n\s*\n/).filter(Boolean).length ? cleanText.split(/\n\s*\n/).filter(Boolean) : ["Please try again."] };
}
