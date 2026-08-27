import assert from "node:assert/strict";
import test from "node:test";
import { routeResponseKind } from "../src/responses/router.js";
import { renderStructuredResponse } from "../src/responses/render.js";
import type { StructuredResponse } from "../src/responses/types.js";

test("routes the ten core intents without network access", () => {
  const cases: Array<[string, string]> = [["Какие рестораны открыты?", "places_list"], ["Стоит ли идти в Catch?", "place_detail"], ["Weather now", "weather"], ["Что сегодня происходит на Пхукете?", "events"], ["Where exchange USD to THB?", "rate"], ["Где арендовать машину?", "rental_list"], ["Где лучше жить месяц?", "area_recommendation"], ["Bang Tao или Rawai?", "comparison"], ["Что посмотреть за один день?", "itinerary"], ["Как купить SIM-карту?", "general"]];
  for (const [input, kind] of cases) assert.equal(routeResponseKind(input), kind, input);
});

test("renders place cards, omits absent metadata and builds safe indexed actions", () => {
  const structured: StructuredResponse = { kind: "places_list", language: "ru", heading: "Я бы смотрела эти 3 места", items: [
    { name: "A <Beach>", area: "Bang Tao", open_status: "open", closing_time: "02:00", rating: 4.5, price_level: "฿฿฿", reason_to_choose: "Лучше для музыки.", map_url: "https://maps.google.com/?q=A&utm_source=openai", website_url: "https://a.example/?utm_source=openai" },
    { name: "B", area: "Rawai", open_status: "closed", reason_to_choose: "Тише остальных." },
    { name: "C", reason_to_choose: "Лучше для кофе.", website_url: "javascript:alert(1)" },
  ] };
  const out = renderStructuredResponse(structured);
  assert.match(out.text, /A &lt;Beach&gt;/); assert.match(out.text, /🟢/); assert.match(out.text, /🔴/);
  assert.doesNotMatch(out.text, /full address|undefined|\*\*|##|https?:\/\//);
  assert.equal(out.actions.length, 3); assert.ok(out.actions.flat().length <= 10);
  assert.doesNotMatch(JSON.stringify(out.actions), /utm_source|javascript/);
  assert.deepEqual(out.actions[0].map((x) => x.text), ["📍 1. На карте", "🌐 1. Сайт"]);
  assert.deepEqual(out.actions[1].map((x) => x.text), ["📍 2. На карте"]);
});

test("single place uses unindexed Map and Instagram site fallback", () => {
  const out = renderStructuredResponse({ kind: "place_detail", language: "en", name: "Catch", summary: "Good for music.", map_url: "https://www.google.com/maps/place/Catch", instagram_url: "https://instagram.com/catchbeachclub" });
  assert.deepEqual(out.actions[0].map((x) => x.text), ["📍 Map", "🌐 Website"]);
});

test("renders current and forecast weather in Russian, English and Thai", () => {
  for (const language of ["ru", "en", "th"] as const) {
    const current = renderStructuredResponse({ kind: "weather", language, heading: "Phuket", temperature: "+28°C", condition: "cloudy", humidity: "80%" });
    assert.match(current.text, /<b>\+28°C<\/b>/); assert.equal(current.actions.length, 0);
    const forecast = renderStructuredResponse({ kind: "weather", language, heading: "Phuket", temperature: "+28°C", condition: "cloudy", forecast: [{ day: "Sat", temperature: "+26…32°C", condition: "rain" }] });
    assert.match(forecast.text, /Sat/);
  }
});

test("renders every remaining layout without Markdown or raw links", () => {
  const values: StructuredResponse[] = [
    { kind: "events", language: "ru", heading: "Сегодня", items: [{ name: "Market", summary: "Для ужина.", time: "19:00" }] },
    { kind: "rate", language: "en", heading: "Exchange", items: [{ name: "X", pair: "USD → THB", rate: "32.45", confirmation: "Confirmed 14:35" }, { name: "Y", pair: "USD → THB", confirmation: "Live rate unavailable" }] },
    { kind: "rental_list", language: "en", heading: "Cars", items: [{ name: "Rent", vehicle: "Yaris", reason_to_choose: "Compact." }] },
    { kind: "property_list", language: "en", heading: "Homes", items: [{ name: "Condo", bedrooms: "1 bedroom", reason_to_choose: "Central." }] },
    { kind: "comparison", language: "en", heading: "Short answer", options: [{ name: "A", points: ["Quiet"] }] },
    { kind: "itinerary", language: "en", heading: "My day", stops: [{ time: "09:00", name: "Town", description: "Coffee." }] },
    { kind: "general", language: "th", heading: "AIS หรือ True", paragraphs: ["ใช้หนังสือเดินทาง"] },
    { kind: "freshness_fallback", language: "ru", heading: "Не удалось подтвердить", explanation: "Данные могли измениться." },
  ];
  for (const value of values) assert.doesNotMatch(renderStructuredResponse(value).text, /\*\*|##|https?:\/\//);
});
