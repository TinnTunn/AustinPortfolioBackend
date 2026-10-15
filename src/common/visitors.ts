/** Helpers shared by the visit counter and the usage counters. */

/** Crawlers, link previews, monitors, and scripts — never counted. */
export const BOT_UA =
  /bot|crawl|spider|slurp|preview|fetch|scan|monitor|uptime|pingdom|lighthouse|headless|facebookexternalhit|embedly|whatsapp|telegram|discord|slack|curl|wget|python|node|axios|go-http|java\/|okhttp|vercel/i;

/** Today's date in Jakarta, e.g. "2026-09-29" — the day boundary for all stats. */
export function jakartaDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(date);
}

/** `day` (YYYY-MM-DD) shifted by `delta` days. */
export function shiftDay(day: string, delta: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
