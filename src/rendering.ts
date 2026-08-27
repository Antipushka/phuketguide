
function normalizeSourceUrl(value: string): string {
  try {
    const url = new URL(value); url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_") || ["fbclid", "gclid", "yclid", "ref", "referrer", "source"].includes(key.toLowerCase())) url.searchParams.delete(key);
    }
    return url.toString();
  } catch { return value; }
}

const SOURCE_HEADING = /^\s*(?:#{1,6}\s*)?(?:sources?|источники|แหล่งที่มา|quellen|sources utilisées)\s*:?[\s\S]*$/imu;

function escapeHtml(value: string): string {
  return value.replace(/&(?!(?:amp|lt|gt|quot|#39);)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Converts the small Markdown subset models commonly emit into Telegram-safe HTML. */
export function renderTelegramHtml(raw: string): string {
  let text = raw.replace(SOURCE_HEADING, "").trim();
  text = text.replace(/^#{1,6}\s+/gm, "");
  text = escapeHtml(text);
  const seenUrls = new Set<string>();
  text = text.replace(/\[([^\]]+)]\((https?:\/\/[^\s)]+)\)/g, (_all, label: string, input: string) => {
    const url = normalizeSourceUrl(input.replace(/&amp;/g, "&"));
    if (seenUrls.has(url)) return "";
    seenUrls.add(url);
    return `<a href="${url.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}">${label}</a>`;
  });
  text = text.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>").replace(/__([^_\n]+)__/g, "<b>$1</b>");
  text = text.replace(/(^|[\s(])(https?:\/\/[^\s<]+)/g, (_all, prefix: string, input: string) => {
    const punctuation = /[.,!?;:]$/.test(input) ? input.slice(-1) : "";
    const url = normalizeSourceUrl(punctuation ? input.slice(0, -1) : input);
    if (seenUrls.has(url)) return punctuation;
    seenUrls.add(url);
    return `${prefix}<a href="${url.replace(/&/g, "&amp;")}">Подробнее</a>${punctuation}`;
  });
  // Remove remaining Markdown emphasis markers without touching ordinary underscores.
  text = text.replace(/(^|\s)[*_](\S(?:.*?\S)?)[*_](?=\s|[.,!?]|$)/g, "$1$2");
  const seenParagraphs = new Set<string>();
  return text.split(/\n\s*\n/).filter((paragraph) => {
    const key = paragraph.replace(/<a\b[^>]*>.*?<\/a>/g, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!key || seenParagraphs.has(key)) return false;
    seenParagraphs.add(key); return true;
  }).join("\n\n").trim();
}

export function removeHistoricalWeatherBlock(text: string): string {
  const paragraphs = text.split(/\n\s*\n/);
  const firstHistorical = paragraphs.findIndex((p) => /(?:historical|archive|climate averages?|историчес|архив|средн(?:яя|ие).*погод|สภาพอากาศในอดีต)/i.test(p));
  return (firstHistorical < 0 ? text : paragraphs.slice(0, firstHistorical).join("\n\n")).trim();
}
