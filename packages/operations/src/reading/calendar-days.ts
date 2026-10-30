const isoDay = /^\d{4}-\d{2}-\d{2}$/u;

export function isCalendarDay(text: string): boolean {
  const time = Date.parse(`${text}T00:00:00Z`);
  return isoDay.test(text) && Number.isFinite(time) && new Date(time).toISOString().startsWith(text);
}
