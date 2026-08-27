import type { ResponseKind } from "./types.js";

/** Fast local routing fallback; the Responses request also receives this kind as its schema contract. */
export function routeResponseKind(input: string): ResponseKind {
  const q = input.toLocaleLowerCase();
  if (/(weather|погод|อากาศ)/u.test(q)) return "weather";
  if (/(event|событ|мероприят|происходит сегодня|сегодня происходит|อีเวนต์|กิจกรรม)/u.test(q)) return "events";
  if (/(exchange|курс|обмен|поменять|แลกเงิน|usd|eur).*(thb|бат|baht|บาท)|(где|where|ที่ไหน).*(exchange|обмен|แลกเงิน)/u.test(q)) return "rate";
  if (/(rent|аренд|снять|เช่า).*(car|bike|машин|байк|รถ)/u.test(q)) return "rental_list";
  if (/(за день|один день|one day|1 day|itinerary|маршрут|แพลน.*วัน|เที่ยว.*วัน)/u.test(q)) return "itinerary";
  if (/(где лучше жить|месяц жизни|where.*live|stay.*month|อยู่.*เดือน)/u.test(q)) return "area_recommendation";
  if (/\b(vs|versus|or)\b| или |сравн|compare|เทียบ|หรือ/u.test(q)) return "comparison";
  if (/(condo|property|apartment|кондоминиум|квартир|жиль[её]|บ้าน|คอนโด)/u.test(q)) return "property_list";
  if (/(стоит ли|как тебе|what do you think of|is .* worth|ควรไป)/u.test(q)) return "place_detail";
  if (/(restaurant|cafe|bar|beach club|where.*eat|place|куда|ресторан|кафе|бар|где поесть|ร้านอาหาร|คาเฟ่|กินที่ไหน)/u.test(q)) return "places_list";
  return "general";
}
