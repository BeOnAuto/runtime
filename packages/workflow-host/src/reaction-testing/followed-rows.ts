import { statement } from '@on.auto/ledger';
import { Effect, Schema } from 'effect';

import { oneRowOf, WholeNumber } from '../database/host-database.ts';
import type { HostNote } from '../host/host-reports.ts';
import { until } from '../testing/until.ts';
import type { MovedClock } from './moved-clock.ts';
import { alpha } from './playbook-writes.ts';
import type { ReactingHost } from './reacting-host.ts';

const HoldRow = Schema.Struct({
  held_since: Schema.NullOr(WholeNumber),
  held_until: Schema.NullOr(WholeNumber),
  holds: WholeNumber,
  held_for: Schema.NullOr(Schema.String),
  attempts: WholeNumber,
  waiting: WholeNumber,
  checked: WholeNumber,
});

export type HoldState = typeof HoldRow.Type;

export interface Holding {
  readonly reacting: ReactingHost;
  readonly clock: MovedClock;
}

export function holdStateOf({ reacting }: Holding): Promise<HoldState> {
  return Effect.runPromise(
    oneRowOf(
      HoldRow,
      reacting.database.read(
        statement`SELECT held_since, held_until, holds, held_for, attempts, waiting, checked
          FROM workflow_followed_playbooks WHERE playbook_key = ${alpha}`,
      ),
    ),
  );
}

export function holdReaching(holding: Holding, reached: (state: HoldState) => boolean): Promise<HoldState> {
  return until(() => holdStateOf(holding), reached);
}

export function heldUntil(state: HoldState): number {
  return Number(state.held_until);
}

export function waitedFor(state: HoldState, tried: number): number {
  return heldUntil(state) - tried;
}

export function causesOf({ reacting }: Holding): readonly string[] {
  return reacting.reactions.starts().map(({ cause }) => cause);
}

export function notesOf({ reacting }: Holding, kind: HostNote['kind']): readonly HostNote[] {
  return reacting.notes().filter((note) => note.kind === kind);
}

export function notesReaching(holding: Holding, kind: HostNote['kind'], count: number): Promise<readonly HostNote[]> {
  return until(
    () => notesOf(holding, kind),
    (notes) => notes.length >= count,
  );
}
