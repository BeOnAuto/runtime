import { Effect } from 'effect';

import type { HeldAtTheRecordFor } from '../follower/followed-orgs.ts';
import { playbookOfKey } from '../follower/record-steps.ts';
import type { HostReports } from '../host/host-reports.ts';
import type { HoldNotes, HoldTried } from './playbook-holds.ts';

function factUnreadableNoted(reports: HostReports, playbookKey: string, { hold, first, record }: HoldTried) {
  return first && hold.heldFor === 'unreadable'
    ? reports.note({ kind: 'fact_unreadable', ...playbookOfKey(playbookKey), recordId: record.id, type: record.type })
    : Effect.void;
}

function noted(heldFor: string, note: () => Effect.Effect<void>): Effect.Effect<void> {
  return heldFor === 'delivery' ? Effect.void : Effect.suspend(note);
}

function triedNoted(notes: ContentHoldNotes, playbookKey: string, tried: HoldTried): Effect.Effect<void> {
  const { heldFor } = tried.hold;
  return heldFor === 'delivery'
    ? Effect.void
    : notes.tried(playbookKey, { ...tried, hold: { ...tried.hold, heldFor } });
}

export function holdNotesBy(reports: HostReports): HoldNotes {
  const notes = contentHoldNotesBy(reports);
  return {
    tried: (playbookKey, tried) => triedNoted(notes, playbookKey, tried),
    failed: (playbookKey, failed) => noted(failed.hold.heldFor, () => notes.failed(playbookKey, failed)),
    lifted: (playbookKey, lifted) => noted(lifted.hold.heldFor, () => notes.lifted(playbookKey, lifted)),
  };
}

interface ContentHoldNotes extends Omit<HoldNotes, 'tried'> {
  readonly tried: (
    playbookKey: string,
    tried: HoldTried & { readonly hold: { readonly heldFor: HeldAtTheRecordFor } },
  ) => Effect.Effect<void>;
}

function contentHoldNotesBy(reports: HostReports): ContentHoldNotes {
  return {
    tried: (playbookKey, tried) => {
      const { hold, record, lag, at } = tried;
      return Effect.andThen(
        factUnreadableNoted(reports, playbookKey, tried),
        reports.note({
          kind: 'content_hold',
          ...playbookOfKey(playbookKey),
          heldFor: hold.heldFor,
          heldSince: hold.since,
          heldMs: at - hold.since,
          holds: hold.holds,
          heldUntil: hold.until,
          recordId: record.id,
          type: record.type,
          lag: lag.records,
          lagCapped: lag.capped,
        }),
      );
    },
    failed: (playbookKey, { hold, at, retryAt }) =>
      reports.note({
        kind: 'content_hold_try_failed',
        ...playbookOfKey(playbookKey),
        heldFor: hold.heldFor,
        heldSince: hold.since,
        heldMs: at - hold.since,
        holds: hold.holds,
        retryAt,
      }),
    lifted: (playbookKey, { hold, at, records, more }) =>
      reports.note({
        kind: 'content_hold_lifted',
        ...playbookOfKey(playbookKey),
        heldFor: hold.heldFor,
        heldSince: hold.since,
        heldMs: at - hold.since,
        holds: hold.holds,
        records,
        more,
      }),
  };
}
