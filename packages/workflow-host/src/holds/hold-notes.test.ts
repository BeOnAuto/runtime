import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { Hold } from '../follower/followed-playbooks.ts';
import { recordingReports } from '../testing/recording-reports.ts';
import { holdNotesBy } from './hold-notes.ts';

const now = Date.parse('2026-11-11T09:00:00.000Z');

const playbookKey = 'playbook/acme/alpha/';

const record = { id: 'r-1', type: 'run_started' };

const lag = { records: 100, capped: true };

function notesOf(work: (notes: ReturnType<typeof holdNotesBy>) => Effect.Effect<void>) {
  const recording = recordingReports();
  Effect.runSync(work(holdNotesBy(recording.reports)));
  return recording.notes();
}

describe('the notes of a playbook’s hold', () => {
  it('say each try, with what the hold is for, how long it has lasted, its tries, when it is tried again and the lag behind it', () => {
    const hold: Hold = { heldFor: 'content', since: now - 300_000, until: now + 60_000, holds: 12 };

    const notes = notesOf((holds) => holds.tried(playbookKey, { hold, first: false, record, lag, at: now }));

    expect(notes).toEqual([
      {
        kind: 'content_hold',
        org: 'acme',
        playbook: 'alpha',
        heldFor: 'content',
        heldSince: now - 300_000,
        heldMs: 300_000,
        holds: 12,
        heldUntil: now + 60_000,
        recordId: 'r-1',
        type: 'run_started',
        lag: 100,
        lagCapped: true,
      },
    ]);
  });

  it('say the record this release cannot read at the first try held for it, and only then', () => {
    const hold: Hold = { heldFor: 'unreadable', since: now, until: now + 1000, holds: 1 };

    const notes = notesOf((holds) =>
      Effect.andThen(
        holds.tried(playbookKey, { hold, first: true, record, lag, at: now }),
        holds.tried(playbookKey, { hold: { ...hold, holds: 2 }, first: false, record, lag, at: now + 1000 }),
      ),
    );

    expect(notes.map(({ kind }) => kind)).toEqual(['fact_unreadable', 'content_hold', 'content_hold']);
    expect(notes[0]).toEqual({
      kind: 'fact_unreadable',
      org: 'acme',
      playbook: 'alpha',
      recordId: 'r-1',
      type: 'run_started',
    });
  });
});

describe('the notes of a playbook’s hold, as it begins and lifts', () => {
  it('say the first try held for the content alone', () => {
    const hold: Hold = { heldFor: 'content', since: now, until: now + 1000, holds: 1 };

    const notes = notesOf((holds) => holds.tried(playbookKey, { hold, first: true, record, lag, at: now }));

    expect(notes.map(({ kind }) => kind)).toEqual(['content_hold']);
  });

  it('say a try that failed before it reached the record, with how long the hold has lasted and when it is tried again', () => {
    const hold: Hold = { heldFor: 'unreadable', since: now - 600_000, until: now, holds: 4 };

    const notes = notesOf((holds) => holds.failed(playbookKey, { hold, at: now, retryAt: now + 60_000 }));

    expect(notes).toEqual([
      {
        kind: 'content_hold_try_failed',
        org: 'acme',
        playbook: 'alpha',
        heldFor: 'unreadable',
        heldSince: now - 600_000,
        heldMs: 600_000,
        holds: 4,
        retryAt: now + 60_000,
      },
    ]);
  });

  it('say the lift, with how long the hold lasted, its tries and the records the pass that lifted it moved past', () => {
    const hold: Hold = { heldFor: 'content', since: now - 3_600_000, until: now, holds: 70 };

    const notes = notesOf((holds) => holds.lifted(playbookKey, { hold, at: now, records: 250, more: true }));

    expect(notes).toEqual([
      {
        kind: 'content_hold_lifted',
        org: 'acme',
        playbook: 'alpha',
        heldFor: 'content',
        heldSince: now - 3_600_000,
        heldMs: 3_600_000,
        holds: 70,
        records: 250,
        more: true,
      },
    ]);
  });
});
