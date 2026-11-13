import { describe, expect, it } from 'vitest';

import { scheduleNamed } from '../index.ts';
import { runFinishedAt, runRejected } from './event-words.ts';

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

describe('the words of a run that reached a limit, in the playbook’s history', () => {
  it('say a run answered from what it had, or was cut off, at its limit, and give no count a person would need explained', () => {
    expect([
      runFinishedAt('max_tool_calls'),
      runFinishedAt('max_input_tokens'),
      runFinishedAt('max_output_tokens'),
    ]).toEqual([
      'A run finished with an answer from what it had, after it reached its limit of tool calls.',
      'A run finished with an answer from what it had, after it had read as much as a run may read.',
      'A run finished with an answer cut off at its length limit.',
    ]);
  });

  it('say a run stopped at a limit did not go through, in the words of its kind and of the limit', () => {
    const stopped = { reason: 'conflict', detail: 'The run stopped at a limit' } as const;

    expect([
      runRejected({ ...stopped, kind: 'unworkable', because: 'max_tool_calls' }),
      runRejected({ ...stopped, kind: 'unworkable', because: 'max_input_tokens' }),
    ]).toEqual([
      'A run did not go through: it cannot work as it is written, because it needed more tool calls than a run may make.',
      'A run did not go through: it cannot work as it is written, because it needed to read more than a run may read.',
    ]);
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
