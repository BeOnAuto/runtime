import { runIds, type MeteredRun } from '@on.auto/definitions';
import {
  Conflict,
  runStreamNameOf,
  streamPrefixOfDefinition,
  streamPrefixOfOrg,
  Unavailable,
  type Ledger,
} from '@on.auto/operations';
import { DateTime, Effect } from 'effect';

import { firstStartIn } from '../counting/first-starts.ts';
import type { Fallback } from '../licensing/signed-answers.ts';
import type { MeterCommand } from '../meter-stream/meter-commands.ts';
import { meterDecider } from '../meter-stream/meter-decider.ts';
import { METER_STREAM, type MeterState } from '../meter-stream/meter-events.ts';

export interface MeterOptions {
  readonly allowance: number;
  readonly freeRate: Fallback;
  readonly holdMs: number;
  readonly studio: string;
}

export const meterDefaults: MeterOptions = {
  allowance: 100,
  freeRate: { per_day: 15, per_month: 75 },
  holdMs: 600_000,
  studio: 'https://studio.on.auto',
};

export interface Metering {
  readonly ledger: Ledger['Service'];
  readonly options: MeterOptions;
}

export const meterUnavailable = new Unavailable({
  detail: 'The run could not start because the runtime could not read its ledger. Try again shortly.',
  kind: 'meter_unavailable',
});

export function licensesPageOf({ studio }: Pick<MeterOptions, 'studio'>, installation: string | undefined): string {
  return installation === undefined ? `${studio}/licenses` : `${studio}/licenses?installation=${installation}`;
}

export function billingPageOf({ studio }: MeterOptions, org: string): string {
  return `${studio}/?settings=billing&org=${encodeURIComponent(org)}`;
}

function definitionKeyOf({ org, definition_id: definition }: MeteredRun): string {
  return streamPrefixOfDefinition({ org, definition });
}

function runStreamOf(run: MeteredRun): string {
  return `${definitionKeyOf(run)}${runStreamNameOf(run.run_id.toLowerCase())}`;
}

export function actionOf({ org, run_id: runId }: MeteredRun): string {
  return `${org}/${runId.toLowerCase()}`;
}

export function heldRunOf(run: MeteredRun): string {
  return `${streamPrefixOfOrg(run)}${runStreamNameOf(run.run_id.toLowerCase())}`;
}

export const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

export const meterStateOf = ({ ledger }: Pick<Metering, 'ledger'>): Effect.Effect<MeterState> =>
  Effect.map(ledger.load(METER_STREAM, meterDecider), ({ state }) => state);

function isConcurrentChange(refusal: unknown): boolean {
  return refusal instanceof Conflict && refusal.kind === 'concurrent_change';
}

export function executed(metering: Metering, command: MeterCommand): Effect.Effect<MeterState, Conflict> {
  return metering.ledger.execute(METER_STREAM, meterDecider, command).pipe(
    Effect.retry({ times: metering.options.allowance * 2, while: isConcurrentChange }),
    Effect.map(({ state }) => state),
  );
}

function startedUnder(ledger: Ledger['Service'], run: MeteredRun, holder: string): Effect.Effect<boolean, Conflict> {
  return holder === definitionKeyOf(run)
    ? Effect.map(firstStartIn(ledger, runStreamOf(run)), (first) => first !== undefined)
    : Effect.fail(runIds.heldElsewhere());
}

export function hasStarted({ ledger }: Pick<Metering, 'ledger'>, run: MeteredRun): Effect.Effect<boolean, Conflict> {
  return Effect.flatMap(
    ledger.holderOfRunId({ orgKey: streamPrefixOfOrg(run), runId: run.run_id.toLowerCase() }),
    (holder) => (holder === undefined ? Effect.succeed(false) : startedUnder(ledger, run, holder)),
  );
}
