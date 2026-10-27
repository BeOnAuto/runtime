import { describe, expect, it } from 'vitest';

import { scheduleNamed } from '../index.ts';

describe('the words of a schedule', () => {
  it('say the time zone of a cron schedule, UTC where it names none, and no zone for an every schedule', () => {
    expect([
      scheduleNamed({
        kind: 'cron',
        reference: '/schedule/cron',
        expression: '0 6 * * *',
        time_zone: 'America/New_York',
      }),
      scheduleNamed({ kind: 'cron', reference: '/schedule/cron', expression: '0 6 * * *' }),
      scheduleNamed({ kind: 'every', reference: '/schedule/every', milliseconds: 60_000 }),
    ]).toEqual(['cron schedule in America/New_York', 'cron schedule in UTC', 'every schedule']);
  });
});
