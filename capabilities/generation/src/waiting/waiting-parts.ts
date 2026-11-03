import {
  recordedRunIn,
  runCorrelationIn,
  runSettler,
  type RunDetail,
  type RunStreamAddress,
  type Settlement,
} from '@on.auto/definitions';
import type {
  Lineage,
  PlaybookAddress,
  ProjectionAdvancer,
  ProjectionReader,
  RecordedReader,
  StreamReader,
  StreamWriter,
} from '@on.auto/operations';
import { Effect } from 'effect';

import type { MadeBy } from '../assets/asset-keeping.ts';
import type { GenerationPorts } from '../capability/generation-ports.ts';
import { generationWaitFrom, type GenerationWait } from './generation-wait.ts';
import { waitAfterPoll } from './poll-cadence.ts';
import { advancedOf, generationsWaitingName, type Cadence, type WaitingRow } from './waiting-rows.ts';

export interface WaitingLedger
  extends
    StreamWriter,
    StreamReader,
    Pick<RecordedReader, 'readRecorded'>,
    Pick<ProjectionReader, 'readProjectedRows' | 'readDueRows' | 'nextDueOf'>,
    ProjectionAdvancer {}

export interface WaitingParts extends Pick<
  GenerationPorts,
  'gateways' | 'fetch' | 'content' | 'addresses' | 'bounds' | 'answerMs'
> {
  readonly ledger: WaitingLedger;
}

export interface WaitingPlace {
  readonly playbook: PlaybookAddress;
  readonly key: string;
  readonly row: WaitingRow;
}

export interface Waiting {
  readonly address: RunStreamAddress;
  readonly run: RunDetail;
  readonly wait: GenerationWait;
  readonly madeBy: MadeBy;
  readonly lineage: Lineage;
}

export function cadenceOf({ row }: WaitingPlace): Cadence {
  return { polls: row.polls, progress: row.progress, next_poll_at: row.next_poll_at, ending_due_at: row.ending_due_at };
}

export function advanced(parts: WaitingParts, { playbook, key, row }: WaitingPlace, cadence: Cadence) {
  return parts.ledger.advanceRow(generationsWaitingName, playbook, key, {
    set: advancedOf(cadence),
    when: [
      { column: 'deferred_id', equals: row.deferred_id },
      { column: 'open', equals: true },
    ],
  });
}

function madeByOf(wait: GenerationWait): MadeBy {
  const { kind, model, prompt, parameters, references, cost_usd: costUsd, own_key: ownKey } = wait;
  return {
    kind,
    model,
    prompt,
    parameters,
    references,
    ...(costUsd === undefined ? {} : { cost_usd: costUsd }),
    own_key: ownKey,
  };
}

export function waitingIn(
  parts: WaitingParts,
  { playbook, key, row }: WaitingPlace,
): Effect.Effect<Waiting | undefined> {
  const address = { ...playbook, id: key };
  return Effect.gen(function* () {
    const recorded = yield* recordedRunIn(parts.ledger, address);
    if (recorded?.awaitsSettlement !== true) {
      return yield* Effect.undefined;
    }
    const wait = generationWaitFrom(recorded.run.record);
    const correlationId = yield* runCorrelationIn(parts.ledger, address);
    return {
      address,
      run: recorded.run,
      wait,
      madeBy: madeByOf(wait),
      lineage: { causationId: row.deferred_id, correlationId },
    };
  });
}

export function settled(parts: WaitingParts, { address, lineage }: Waiting, settlement: Settlement) {
  return runSettler(parts.ledger)(address, settlement, lineage).pipe(
    Effect.asVoid,
    Effect.catchTags({ conflict: () => Effect.void, not_found: Effect.die }),
  );
}

export function pollAgain(parts: WaitingParts, place: WaitingPlace, now: number, progress: number | null) {
  const { row } = place;
  const polls = row.polls + 1;
  const wait = waitAfterPoll({ polls, deferredAt: row.deferred_at, now, progress });
  return advanced(parts, place, {
    polls,
    progress,
    next_poll_at: Math.min(now + wait, row.waits_until),
    ending_due_at: row.waits_until,
  });
}

export function inFlightUntil(place: WaitingPlace, until: number) {
  return { ...cadenceOf(place), next_poll_at: until, ending_due_at: Math.max(place.row.waits_until, until) };
}
