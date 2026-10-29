export function dayOf(moment: string): string {
  return moment.slice(0, 10);
}

export function monthOf(moment: string): string {
  return moment.slice(0, 7);
}

function partsOf(moment: string): readonly [number, number, number] {
  const at = new Date(moment);
  return [at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()];
}

export function nextDayOf(moment: string): string {
  const [year, month, day] = partsOf(moment);
  return new Date(Date.UTC(year, month, day + 1)).toISOString();
}

export function nextMonthOf(moment: string): string {
  const [year, month] = partsOf(moment);
  return new Date(Date.UTC(year, month + 1, 1)).toISOString();
}
