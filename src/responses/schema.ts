const string = { type: "string" } as const;
const nullableString = { type: ["string", "null"] } as const;
const nullableNumber = { type: ["number", "null"] } as const;
const language = { type: "string", enum: ["ru", "en", "th", "other"] } as const;

function object(properties: Record<string, unknown>) {
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}

const links = { map_url: nullableString, latitude: nullableNumber, longitude: nullableNumber, website_url: nullableString, instagram_url: nullableString };
const status = { type: ["string", "null"], enum: ["open", "closed", "unknown", null] } as const;
const place = object({ ...links, name: string, area: nullableString, category: nullableString, open_status: status, closing_time: nullableString, rating: nullableNumber, price_level: nullableString, reason_to_choose: string });
const event = object({ ...links, name: string, time: nullableString, area: nullableString, price: nullableString, summary: string });
const rateItem = object({ ...links, name: string, pair: string, rate: nullableString, open_status: status, closing_time: nullableString, area: nullableString, confirmation: nullableString });
const rental = object({ ...links, name: string, vehicle: string, price: nullableString, area: nullableString, reason_to_choose: string });
const property = object({ ...links, name: string, bedrooms: nullableString, size: nullableString, price: nullableString, area: nullableString, reason_to_choose: string });
const stop = object({ ...links, time: nullableString, name: string, description: string });

function response(kind: string, properties: Record<string, unknown>) {
  return object({ kind: { type: "string", const: kind }, language, ...properties });
}

/** Complete transport contract. Nullable fields model optional domain fields in strict mode. */
export const PLOY_RESPONSE_SCHEMA = {
  anyOf: [
    response("places_list", { heading: string, items: { type: "array", minItems: 1, maxItems: 5, items: place }, recommendation: nullableString }),
    response("place_detail", { ...links, name: string, area: nullableString, category: nullableString, open_status: status, closing_time: nullableString, rating: nullableNumber, price_level: nullableString, summary: string, verdict: nullableString }),
    response("weather", { heading: string, temperature: string, condition: string, feels_like: nullableString, humidity: nullableString, wind: nullableString, precipitation: nullableString, today_summary: nullableString, forecast: { anyOf: [{ type: "null" }, { type: "array", items: object({ day: string, temperature: string, condition: string }) }] } }),
    response("events", { heading: string, items: { type: "array", minItems: 1, maxItems: 5, items: event } }),
    response("rate", { heading: string, items: { type: "array", minItems: 1, maxItems: 5, items: rateItem }, note: nullableString }),
    response("rental_list", { heading: string, items: { type: "array", minItems: 1, maxItems: 5, items: rental }, clarification: nullableString }),
    response("property_list", { heading: string, items: { type: "array", minItems: 1, maxItems: 5, items: property } }),
    response("area_recommendation", { heading: string, areas: { type: "array", items: object({ name: string, pros: { type: "array", items: string }, cons: { type: "array", items: string } }) }, recommendation: nullableString }),
    response("comparison", { heading: string, options: { type: "array", items: object({ name: string, points: { type: "array", items: string } }) }, recommendation: nullableString }),
    response("itinerary", { heading: string, stops: { type: "array", items: stop } }),
    response("general", { heading: nullableString, paragraphs: { type: "array", minItems: 1, items: string } }),
  ],
} as const;
