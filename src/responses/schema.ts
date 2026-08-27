const language = { type: "string", enum: ["ru", "en", "th", "other"] } as const;
const string = { type: "string" } as const;
const optionalString = { type: ["string", "null"] } as const;
const url = { type: ["string", "null"], format: "uri", pattern: "^https://" } as const;
const status = { type: ["string", "null"], enum: ["open", "closed", "unknown", null] } as const;

const object = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", properties, required, additionalProperties: false });
const linkable = { map_url: url, website_url: url, instagram_url: url, latitude: { type: ["number", "null"] }, longitude: { type: ["number", "null"] } };
const base = (kind: string) => ({ kind: { type: "string", const: kind }, language });
const place = object({ name: string, area: optionalString, category: optionalString, open_status: status, closing_time: optionalString, rating: { type: ["number", "null"] }, price_level: optionalString, reason_to_choose: string, ...linkable }, ["name", "area", "category", "open_status", "closing_time", "rating", "price_level", "reason_to_choose", ...Object.keys(linkable)]);
const event = object({ name: string, time: optionalString, area: optionalString, price: optionalString, summary: string, ...linkable }, ["name", "time", "area", "price", "summary", ...Object.keys(linkable)]);
const rateItem = object({ name: string, pair: string, rate: optionalString, open_status: status, closing_time: optionalString, area: optionalString, confirmation: optionalString, ...linkable }, ["name", "pair", "rate", "open_status", "closing_time", "area", "confirmation", ...Object.keys(linkable)]);
const rental = object({ name: string, vehicle: string, price: optionalString, area: optionalString, reason_to_choose: string, ...linkable }, ["name", "vehicle", "price", "area", "reason_to_choose", ...Object.keys(linkable)]);
const property = object({ name: string, bedrooms: optionalString, size: optionalString, price: optionalString, area: optionalString, reason_to_choose: string, ...linkable }, ["name", "bedrooms", "size", "price", "area", "reason_to_choose", ...Object.keys(linkable)]);
const top = (kind: string, properties: Record<string, unknown>, required: string[]) => object({ ...base(kind), ...properties }, ["kind", "language", ...required]);

/** Complete discriminated contract sent to Responses API. Every object is closed. */
export const PLOY_RESPONSE_SCHEMA = {
  oneOf: [
    top("places_list", { heading: string, items: { type: "array", minItems: 1, maxItems: 5, items: place }, recommendation: optionalString }, ["heading", "items", "recommendation"]),
    top("place_detail", { name: string, area: optionalString, category: optionalString, open_status: status, closing_time: optionalString, rating: { type: ["number", "null"] }, price_level: optionalString, summary: string, verdict: optionalString, ...linkable }, ["name", "area", "category", "open_status", "closing_time", "rating", "price_level", "summary", "verdict", ...Object.keys(linkable)]),
    top("weather", { heading: string, temperature: string, condition: string, feels_like: optionalString, humidity: optionalString, wind: optionalString, precipitation: optionalString, today_summary: optionalString, forecast: { anyOf: [{ type: "null" }, { type: "array", items: object({ day: string, temperature: string, condition: string }, ["day", "temperature", "condition"]) }] } }, ["heading", "temperature", "condition", "feels_like", "humidity", "wind", "precipitation", "today_summary", "forecast"]),
    top("events", { heading: string, items: { type: "array", maxItems: 5, items: event } }, ["heading", "items"]),
    top("rate", { heading: string, items: { type: "array", maxItems: 5, items: rateItem }, note: optionalString }, ["heading", "items", "note"]),
    top("rental_list", { heading: string, items: { type: "array", maxItems: 5, items: rental }, clarification: optionalString }, ["heading", "items", "clarification"]),
    top("property_list", { heading: string, items: { type: "array", maxItems: 5, items: property } }, ["heading", "items"]),
    top("area_recommendation", { heading: string, areas: { type: "array", items: object({ name: string, pros: { type: "array", items: string }, cons: { type: "array", items: string } }, ["name", "pros", "cons"]) }, recommendation: optionalString }, ["heading", "areas", "recommendation"]),
    top("comparison", { heading: string, options: { type: "array", items: object({ name: string, points: { type: "array", items: string } }, ["name", "points"]) }, recommendation: optionalString }, ["heading", "options", "recommendation"]),
    top("itinerary", { heading: string, stops: { type: "array", items: object({ time: optionalString, name: string, description: string, ...linkable }, ["time", "name", "description", ...Object.keys(linkable)]) } }, ["heading", "stops"]),
    top("general", { heading: optionalString, paragraphs: { type: "array", minItems: 1, items: string } }, ["heading", "paragraphs"]),
    top("freshness_fallback", { heading: string, explanation: string, next_step: optionalString }, ["heading", "explanation", "next_step"]),
  ],
} as const;
