import { createHash } from 'node:crypto';

import { civilDay, civilOfDay } from '../periods/civil-days.ts';

export interface DailyRows {
  readonly text: string;
  readonly sha256: string;
}

export type ValueOf = (series: string, day: number) => number | null;

function dayForm(day: number): string {
  const { year, month, day: date } = civilOfDay(day);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
}

export const firstDay = civilDay({ year: 2026, month: 8, day: 31 });

export function dailyRows(target: string, series: readonly string[], days: number, valueOf: ValueOf): DailyRows {
  const records = [`series,period,${target}`];
  for (const name of series) {
    for (let day = firstDay; day < firstDay + days; day += 1) {
      const value = valueOf(name, day - firstDay);
      records.push(`${name},${dayForm(day)},${value === null ? '' : JSON.stringify(value)}`);
    }
  }
  const text = `${records.join('\r\n')}\r\n`;
  return { text, sha256: createHash('sha256').update(text, 'utf8').digest('hex') };
}

export function steadyVisits(series: string, day: number): number {
  return (series === 'north' ? 10 : 20) + (day % 3);
}
