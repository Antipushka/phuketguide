export const PHUKET_TIME_ZONE = "Asia/Bangkok";

export type OpenStatus = "OPEN" | "CLOSED" | "UNKNOWN";
export interface HoursInterval { open: string; close: string }
export type WeeklyHours = Partial<Record<number, HoursInterval[]>>;

export interface PhuketDateTime {
  date: string;
  time: string;
  weekday: string;
  weekdayIndex: number;
  timezone: typeof PHUKET_TIME_ZONE;
  offset: "UTC+7";
}

export function getPhuketDateTime(now = new Date()): PhuketDateTime {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PHUKET_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "long",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  const weekday = part("weekday");
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
    weekday,
    weekdayIndex: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].indexOf(weekday),
    timezone: PHUKET_TIME_ZONE,
    offset: "UTC+7",
  };
}

export function phuketDateTimeContext(now = new Date()): string {
  const local = getPhuketDateTime(now);
  return `Current Phuket local datetime: ${local.date} ${local.time}, ${local.weekday}, ${local.timezone} (${local.offset})`;
}

function minutes(value: string): number | undefined {
  if (!/^\d{1,2}:\d{2}$/.test(value)) return undefined;
  const [hour, minute] = value.split(":").map(Number);
  if (hour > 24 || minute > 59 || (hour === 24 && minute !== 0)) return undefined;
  return hour * 60 + minute;
}

/** Determines status from weekday-specific hours. Midnight is an exclusive closing boundary. */
export function getOpenStatus(hours: WeeklyHours | undefined, local: Pick<PhuketDateTime, "time" | "weekdayIndex">): OpenStatus {
  if (!hours || local.weekdayIndex < 0) return "UNKNOWN";
  const now = minutes(local.time);
  if (now === undefined) return "UNKNOWN";
  const today = hours[local.weekdayIndex] ?? [];
  for (const interval of today) {
    const open = minutes(interval.open); const close = minutes(interval.close);
    if (open === undefined || close === undefined) continue;
    if (open < close && now >= open && now < close) return "OPEN";
    if (open > close && now >= open) return "OPEN";
  }
  // The after-midnight part belongs to an interval that began on the previous day.
  const previous = hours[(local.weekdayIndex + 6) % 7] ?? [];
  for (const interval of previous) {
    const open = minutes(interval.open); const close = minutes(interval.close);
    if (open !== undefined && close !== undefined && open > close && now < close) return "OPEN";
  }
  return today.length || previous.length ? "CLOSED" : "UNKNOWN";
}

export interface PlaceWithStatus { status: OpenStatus }
export function filterOpenNow<T extends PlaceWithStatus>(places: T[], limit = 5): T[] {
  return places.filter((place) => place.status === "OPEN").slice(0, limit);
}

export function isOpenToday(hours: WeeklyHours | undefined, weekdayIndex: number): boolean {
  return Boolean(hours?.[weekdayIndex]?.length);
}
