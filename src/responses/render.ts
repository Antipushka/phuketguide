import { normalizeSourceUrl } from "../openai.js";
import type { Language, Linkable, RenderedResponse, StructuredResponse, TelegramActionRow } from "./types.js";

export const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const e = (v: unknown) => escapeHtml(String(v ?? ""));
const labels = (language: Language) => language === "ru" ? { map: "На карте", site: "Сайт", open: "Открыто", closed: "Закрыто", until: "до", feels: "Ощущается как", humidity: "Влажность", wind: "Ветер", rain: "Дождь", days: "Ближайшие дни" }
  : language === "th" ? { map: "แผนที่", site: "เว็บไซต์", open: "เปิด", closed: "ปิด", until: "ถึง", feels: "รู้สึกเหมือน", humidity: "ความชื้น", wind: "ลม", rain: "ฝน", days: "วันถัดไป" }
  : { map: "Map", site: "Website", open: "Open", closed: "Closed", until: "until", feels: "Feels like", humidity: "Humidity", wind: "Wind", rain: "Rain", days: "Next days" };

export function validActionUrl(input?: string): string | undefined {
  if (!input) return;
  try { const u = new URL(normalizeSourceUrl(input)); return u.protocol === "https:" && !u.username && !u.password ? u.toString() : undefined; } catch { return; }
}
function mapUrl(x: Linkable & { name?: string; area?: string }): string | undefined {
  const direct = validActionUrl(x.map_url);
  if (direct && /(^|\.)google\.[^/]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps/.test(new URL(direct).hostname + new URL(direct).pathname)) return direct;
  if (Number.isFinite(x.latitude) && Number.isFinite(x.longitude)) return `https://www.google.com/maps/search/?api=1&query=${x.latitude},${x.longitude}`;
  if (x.name?.trim()) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${x.name} ${x.area || "Phuket"}`)}`;
}
function officialUrl(x: Linkable): string | undefined {
  const candidate = validActionUrl(x.website_url) || validActionUrl(x.instagram_url);
  if (!candidate) return;
  const host = new URL(candidate).hostname.replace(/^www\./, "");
  if (/tripadvisor|yelp|agoda|booking\.com|google\./i.test(host)) return;
  return candidate;
}
function actionRow(x: Linkable & { name?: string; area?: string }, language: Language, index?: number): TelegramActionRow {
  const l = labels(language), prefix = index ? `${index}. ` : "", row: TelegramActionRow = [];
  const map = mapUrl(x), site = officialUrl(x);
  if (map) row.push({ text: `📍 ${prefix}${l.map}`, url: map });
  if (site) row.push({ text: `🌐 ${prefix}${l.site}`, url: site });
  return row;
}
function status(x: { open_status?: string; closing_time?: string }, language: Language): string | undefined {
  const l = labels(language);
  if (x.open_status === "open") return `🟢 ${l.open}${x.closing_time ? ` ${l.until} ${e(x.closing_time)}` : ""}`;
  if (x.open_status === "closed") return `🔴 ${l.closed}`;
}
const compact = (parts: Array<string | undefined | false>) => parts.filter(Boolean).join(" · ");

export function renderStructuredResponse(r: StructuredResponse): RenderedResponse {
  const sections: string[] = [], actions: TelegramActionRow[] = [];
  const heading = (s: string) => sections.push(`<b>${e(s)}</b>`);
  switch (r.kind) {
    case "places_list":
      heading(r.heading); r.items.slice(0, 5).forEach((x, i) => { sections.push([`<b>${i + 1}. ${e(x.name)}</b>`, status(x, r.language), compact([x.area && `📍 ${e(x.area)}`, x.category && e(x.category)]), compact([x.price_level && `💸 ${e(x.price_level)}`, typeof x.rating === "number" && `⭐ ${e(x.rating)}`]), "", e(x.reason_to_choose)].filter((v) => v !== undefined && v !== "").join("\n")); const row = actionRow(x, r.language, i + 1); if (row.length) actions.push(row); }); if (r.recommendation) sections.push(e(r.recommendation)); break;
    case "place_detail":
      heading(r.name); sections.push([status(r, r.language), r.area && `📍 ${e(r.area)}`, r.price_level && `💸 ${e(r.price_level)}`, typeof r.rating === "number" && `⭐ ${e(r.rating)}`].filter(Boolean).join("\n")); sections.push(e(r.summary)); if (r.verdict) sections.push(`<b>${e(r.verdict)}</b>`); { const row = actionRow(r, r.language); if (row.length) actions.push(row); } break;
    case "weather": { const l = labels(r.language); heading(r.heading); sections.push(`🌤 <b>${e(r.temperature)}</b> · ${e(r.condition)}${r.feels_like ? `\n${l.feels} ${e(r.feels_like)}` : ""}`); sections.push([r.humidity && `💧 ${l.humidity} — ${e(r.humidity)}`, r.wind && `💨 ${l.wind} — ${e(r.wind)}`, r.precipitation && `🌧 ${l.rain} — ${e(r.precipitation)}`].filter(Boolean).join("\n")); if (r.today_summary) sections.push(e(r.today_summary)); if (r.forecast?.length) { sections.push(`<b>${l.days}</b>\n\n${r.forecast.map((x) => `• ${e(x.day)} · ${e(x.temperature)} · ${e(x.condition)}`).join("\n")}`); } break; }
    case "events":
      heading(r.heading); r.items.slice(0, 5).forEach((x, i) => { sections.push([`<b>${i + 1}. ${e(x.name)}</b>`, x.time && `🕐 ${e(x.time)}`, x.area && `📍 ${e(x.area)}`, x.price && `🎟 ${e(x.price)}`, "", e(x.summary)].filter((v) => v !== undefined).join("\n")); const row = actionRow(x, r.language, i + 1); if (row.length) actions.push(row); }); break;
    case "rate":
      heading(r.heading); r.items.slice(0, 5).forEach((x, i) => { sections.push([`<b>${i + 1}. ${e(x.name)}</b>`, `💱 ${e(x.pair)}${x.rate ? ` · ${e(x.rate)}` : ""}`, status(x, r.language), x.area && `📍 ${e(x.area)}`, x.confirmation && `\n${e(x.confirmation)}`].filter(Boolean).join("\n")); const row = actionRow(x, r.language, i + 1); if (row.length) actions.push(row); }); if (r.note) sections.push(e(r.note)); break;
    case "rental_list": case "property_list":
      heading(r.heading); r.items.slice(0, 5).forEach((x, i) => { const isRental = "vehicle" in x; sections.push([`<b>${i + 1}. ${e(x.name)}</b>`, isRental ? `🚗 ${e(x.vehicle)}` : x.bedrooms && `🛏 ${e(x.bedrooms)}`, !isRental && x.size && `📐 ${e(x.size)}`, x.price && `💸 ${e(x.price)}`, x.area && `📍 ${e(x.area)}`, "", e(x.reason_to_choose)].filter((v) => v !== undefined).join("\n")); const row = actionRow(x, r.language, i + 1); if (row.length) actions.push(row); }); if (r.kind === "rental_list" && r.clarification) sections.push(e(r.clarification)); break;
    case "area_recommendation":
      heading(r.heading); r.areas.forEach((a) => sections.push(`<b>${e(a.name)}</b>\n${a.pros.map((p) => `+ ${e(p)}`).join("\n")}${a.cons.length ? `\n${a.cons.map((p) => `− ${e(p)}`).join("\n")}` : ""}`)); if (r.recommendation) sections.push(`<b>${e(r.recommendation)}</b>`); break;
    case "comparison":
      heading(r.heading); r.options.forEach((o) => sections.push(`<b>${e(o.name)}</b>\n${o.points.map((p) => `• ${e(p)}`).join("\n")}`)); if (r.recommendation) sections.push(`<b>${e(r.recommendation)}</b>`); break;
    case "itinerary":
      heading(r.heading); r.stops.forEach((x, i) => { sections.push(`<b>${x.time ? `${e(x.time)} · ` : ""}${e(x.name)}</b>\n${e(x.description)}`); const row = actionRow(x, r.language, i + 1); if (row.length && actions.length < 5) actions.push(row.slice(0, 1)); }); break;
    case "general": if (r.heading) heading(r.heading); sections.push(...r.paragraphs.map(e)); break;
    case "freshness_fallback": heading(r.heading); sections.push(e(r.explanation)); if (r.next_step) sections.push(e(r.next_step)); break;
  }
  const itemCount = "items" in r ? r.items.length : "stops" in r ? r.stops.length : "areas" in r ? r.areas.length : "options" in r ? r.options.length : r.kind === "place_detail" ? 1 : 0;
  const cleanSections = sections.filter(Boolean); return { text: cleanSections.join("\n\n"), sections: cleanSections, actions: actions.slice(0, 5), kind: r.kind, itemCount };
}
