import type { StructuredResponse, ResponseKind, Language } from "./types.js";

const KINDS = new Set<ResponseKind>(["places_list", "place_detail", "weather", "events", "rate", "rental_list", "property_list", "area_recommendation", "comparison", "itinerary", "general", "freshness_fallback"]);
export function validateStructuredResponse(value: unknown): StructuredResponse | undefined {
  if (!value || typeof value !== "object") return;
  const v = value as Record<string, unknown>;
  if (!KINDS.has(v.kind as ResponseKind) || !["ru", "en", "th", "other"].includes(v.language as Language)) return;
  const hasString = (key: string) => typeof v[key] === "string";
  switch (v.kind) {
    case "places_list": case "events": case "rate": case "rental_list": case "property_list": return hasString("heading") && Array.isArray(v.items) ? value as StructuredResponse : undefined;
    case "place_detail": return hasString("name") && hasString("summary") ? value as StructuredResponse : undefined;
    case "weather": return hasString("heading") && hasString("temperature") && hasString("condition") ? value as StructuredResponse : undefined;
    case "area_recommendation": return hasString("heading") && Array.isArray(v.areas) ? value as StructuredResponse : undefined;
    case "comparison": return hasString("heading") && Array.isArray(v.options) ? value as StructuredResponse : undefined;
    case "itinerary": return hasString("heading") && Array.isArray(v.stops) ? value as StructuredResponse : undefined;
    case "general": return Array.isArray(v.paragraphs) ? value as StructuredResponse : undefined;
    case "freshness_fallback": return hasString("heading") && hasString("explanation") ? value as StructuredResponse : undefined;
  }
}

export function safeGeneral(text: string, language: Language = "other"): StructuredResponse {
  const clean = text.replace(/\[[^\]]+\]\(https?:\/\/[^)]+\)/g, "$1").replace(/https?:\/\/\S+/g, "").replace(/^#{1,6}\s*/gm, "").replace(/\*\*/g, "").trim();
  const paragraphs = clean.split(/\n\s*\n/).filter(Boolean);
  return { kind: "general", language, paragraphs: paragraphs.length ? paragraphs : [clean || "Please try again."] };
}
