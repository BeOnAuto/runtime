import { describe, expect, it } from 'vitest';

import { scheduleNamed } from '../index.ts';
import { runRejected } from './event-words.ts';

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

describe('the words of a run refused because the account of its org is closed, in the playbook’s history', () => {
  it('say the account is closed and why, as the words of the meter’s other refusals do', () => {
    const closed = { reason: 'conflict', detail: 'The org acme was deleted', kind: 'account_closed' } as const;

    expect([
      runRejected({ ...closed, because: 'org_deleted' }),
      runRejected({ ...closed, because: 'org_purged' }),
    ]).toEqual([
      'A run did not go through: the account it runs under is closed, since its org was deleted.',
      'A run did not go through: the account it runs under is closed, since its org was deleted for good.',
    ]);
  });
});

describe('the words of a run refused until an owner accepts Auto’s activation terms, in the playbook’s history', () => {
  it('say what Auto needs, as the words of the meter’s other refusals do', () => {
    expect(runRejected({ reason: 'conflict', detail: 'An owner reads and accepts them', kind: 'terms_required' })).toBe(
      'A run did not go through: Auto needs an owner of this runtime’s org to accept its activation terms for self-hosted runtimes.',
    );
  });
});
