import { createHash } from 'node:crypto';

import { dailyRows } from '../testing/daily-rows.ts';

export const weekdaysAndWeekends = dailyRows('sales', ['north', 'south'], 56, (_series, day) =>
  day % 7 < 5 ? 10 : 14,
);

function weekOf(week: number): string {
  return `2026-W${String(week).padStart(2, '0')}`;
}

function weeklyText(): string {
  const weeks = Array.from({ length: 21 }, (_, at) => 20 + at);
  const lines = [
    'series,period,orders,basket,promotion',
    ...weeks.map((week) => `north,${weekOf(week)},5,10,${week % 2}`),
    ...weeks.map((week) => `south,${weekOf(week)},7,12,0`),
  ];
  return `${lines.join('\r\n')}\r\n`;
}

export const weeklyOrderRows = {
  text: weeklyText(),
  sha256: createHash('sha256').update(weeklyText(), 'utf8').digest('hex'),
};
