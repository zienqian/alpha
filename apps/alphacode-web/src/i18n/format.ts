const clocks = new Map<string, Intl.DateTimeFormat>();
export function formatTime(timestamp: number, locale: string): string {
  let clock = clocks.get(locale);
  if (!clock) { clock = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false }); clocks.set(locale, clock); }
  return clock.format(timestamp);
}
