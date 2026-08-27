import type { StructuredResponse, ResponseKind, Language } from "./types.js";

const KINDS = new Set<ResponseKind>(["places_list", "place_detail", "weather", "events", "rate", "rental_list", "property_list", "area_recommendation", "comparison", "itinerary", "general", "freshness_fallback"]);
export function validateStructuredResponse(value: unknown): StructuredResponse | undefined {
  if (!value || typeof value !== "object") return;
  const stripNulls = (input: unknown): void => {
    if (Array.isArray(input)) return input.forEach(stripNulls);
    if (!input || typeof input !== "object") return;
    for (const [key, child] of Object.entries(input)) {
      if (child === null) delete (input as Record<string, unknown>)[key];
      else stripNulls(child);
    }
  };
  stripNulls(value);
  const v = value as Record<string, unknown>;
  if (!KINDS.has(v.kind as ResponseKind) || !["ru", "en", "th", "other"].includes(v.language as Language)) return;
  const hasString = (key: string) => typeof v[key] === "string" && Boolean((v[key] as string).trim());
  const strings = (x: unknown): x is string[] => Array.isArray(x) && x.every((item) => typeof item === "string" && item.trim());
  const cleanLinks = (x: Record<string, unknown>) => {
    for (const key of ["map_url", "website_url", "instagram_url"] as const) {
      let url: string | undefined;
      try {
        const parsed = new URL(typeof x[key] === "string" ? x[key] : "");
        if (parsed.protocol === "https:" && !parsed.username && !parsed.password) url = parsed.toString();
      } catch { /* invalid optional URLs are discarded */ }
      if (url) x[key] = url; else delete x[key];
    }
  };
  const records = (input: unknown, required: string[]) => {
    if (!Array.isArray(input) || !input.length) return false;
    return input.every((item) => {
      if (!item || typeof item !== "object") return false;
      const record = item as Record<string, unknown>;
      if (!required.every((key) => typeof record[key] === "string" && Boolean((record[key] as string).trim()))) return false;
      cleanLinks(record);
      return true;
    });
  };
  switch (v.kind) {
    case "places_list": return hasString("heading") && records(v.items, ["name", "reason_to_choose"]) ? value as StructuredResponse : undefined;
    case "events": return hasString("heading") && records(v.items, ["name", "summary"]) ? value as StructuredResponse : undefined;
    case "rate": return hasString("heading") && records(v.items, ["name", "pair"]) ? value as StructuredResponse : undefined;
    case "rental_list": return hasString("heading") && records(v.items, ["name", "vehicle", "reason_to_choose"]) ? value as StructuredResponse : undefined;
    case "property_list": return hasString("heading") && records(v.items, ["name", "reason_to_choose"]) ? value as StructuredResponse : undefined;
    case "place_detail": if (hasString("name") && hasString("summary")) { cleanLinks(v); return value as StructuredResponse; } return;
    case "weather": return hasString("heading") && hasString("temperature") && hasString("condition") ? value as StructuredResponse : undefined;
    case "area_recommendation": return hasString("heading") && Array.isArray(v.areas) && v.areas.every((x) => x && typeof x === "object" && typeof x.name === "string" && strings(x.pros) && strings(x.cons)) ? value as StructuredResponse : undefined;
    case "comparison": return hasString("heading") && Array.isArray(v.options) && v.options.every((x) => x && typeof x === "object" && typeof x.name === "string" && strings(x.points)) ? value as StructuredResponse : undefined;
    case "itinerary": return hasString("heading") && records(v.stops, ["name", "description"]) ? value as StructuredResponse : undefined;
    case "general": return strings(v.paragraphs) ? value as StructuredResponse : undefined;
    case "freshness_fallback": return hasString("heading") && hasString("explanation") ? value as StructuredResponse : undefined;
  }
}

export function safeGeneral(text: string, language: Language = "other"): StructuredResponse {
  const clean = text.replace(/\[[^\]]+\]\(https?:\/\/[^)]+\)/g, "$1").replace(/https?:\/\/\S+/g, "").replace(/^#{1,6}\s*/gm, "").replace(/\*\*/g, "").trim();
  const paragraphs = clean.split(/\n\s*\n/).filter(Boolean);
  return { kind: "general", language, paragraphs: paragraphs.length ? paragraphs : [clean || "Please try again."] };
}
