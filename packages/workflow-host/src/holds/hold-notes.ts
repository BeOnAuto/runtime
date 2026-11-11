import { Effect } from 'effect';

import { playbookOfKey } from '../follower/record-steps.ts';
import type { HostReports } from '../host/host-reports.ts';
import type { HoldNotes, HoldTried } from './playbook-holds.ts';

function factUnreadableNoted(reports: HostReports, playbookKey: string, { hold, first, record }: HoldTried) {
  return first && hold.heldFor === 'unreadable'
    ? reports.note({ kind: 'fact_unreadable', ...playbookOfKey(playbookKey), recordId: record.id, type: record.type })
    : Effect.void;
}

export function holdNotesBy(reports: HostReports): HoldNotes {
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
