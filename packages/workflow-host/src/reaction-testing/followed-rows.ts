import { statement } from '@on.auto/ledger';
import { Effect, Schema } from 'effect';

import { oneRowOf, rowsOf, WholeNumber } from '../database/host-database.ts';
import type { HostNote } from '../host/host-reports.ts';
import { fewSweeps } from '../testing/stepped-clock.ts';
import { alpha } from './playbook-writes.ts';
import type { SteppedReacting } from './stepped-reactions.ts';

const HoldRow = Schema.Struct({
  held_since: Schema.NullOr(WholeNumber),
  held_until: Schema.NullOr(WholeNumber),
  holds: WholeNumber,
  held_for: Schema.NullOr(Schema.String),
  attempts: WholeNumber,
  place: Schema.NullOr(Schema.String),
});

export type HoldState = typeof HoldRow.Type;

export type Holding = SteppedReacting;

function holdRead({ reacting }: Holding) {
  return reacting.database.read(
    statement`SELECT held.held_since, held.held_until, COALESCE(held.holds, 0) AS holds, held.held_for,
        COALESCE(held.attempts, 0) AS attempts, followed.cursor AS place
      FROM workflow_followed_orgs AS followed
      LEFT JOIN workflow_held_playbooks AS held ON held.playbook_key = ${alpha}
      WHERE followed.org = 'acme'`,
  );
}

export function holdStateOf(holding: Holding): Promise<HoldState> {
  return Effect.runPromise(oneRowOf(HoldRow, holdRead(holding)));
}

/** The hold of the playbook, in the one row of its org, or no row while the follower has not yet placed the org. */
function holdStatesOnceFollowed(holding: Holding): Promise<readonly HoldState[]> {
  return Effect.runPromise(rowsOf(HoldRow, holdRead(holding)));
}

export async function holdReaching(holding: Holding, reached: (state: HoldState) => boolean): Promise<HoldState> {
  const [state] = await holding.sweeps.until(
    () => holdStatesOnceFollowed(holding),
    (found): found is readonly [HoldState] => found.some((row) => reached(row)),
    fewSweeps,
  );
  return state;
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
  return holding.sweeps.until(
    () => notesOf(holding, kind),
    (notes) => notes.length >= count,
    fewSweeps,
  );
}
