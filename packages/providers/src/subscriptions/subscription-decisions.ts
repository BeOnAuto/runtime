import type { Destination } from '../events/destination-fields.ts';
import {
  arrangedAs,
  heldThroughACallOf,
  isHeldByPolling,
  keyIn,
  throughOf,
  type ConnectionState,
  type Held,
  type HeldByPolling,
  type HeldThroughACall,
  type Through,
} from './held-subscriptions.ts';
import { failedBecause } from './subscription-failed.ts';
import type {
  MadeSubscription,
  Positions,
  RecordedFailure,
  RecordedSubscription,
  SubscriptionKey,
} from './subscription-ports.ts';
import {
  earliest,
  holdsARead,
  isHeldBy,
  isTheSameFailure,
  isWaitingToRetry,
  keyOf,
  lapses,
  type Arranging,
  type Subscribable,
} from './subscription-records.ts';

export interface Wanted extends SubscriptionKey {
  readonly destination: Subscribable;
}

export interface Situation {
  readonly now: number;
  readonly mostPerConnection: number;
  readonly connections: ReadonlyMap<string, ConnectionState>;
  readonly wanted: readonly Wanted[];
  readonly recorded: readonly RecordedSubscription[];
}

interface Acting {
  readonly key: SubscriptionKey;
  readonly recorded?: RecordedSubscription | undefined;
}

type Calling = Acting & Through;

type Holding = Calling & { readonly recorded: RecordedSubscription; readonly made: MadeSubscription };

export type Renewable = Arranging & { readonly renew: NonNullable<Destination['renew']> };

export type Step =
  | (Acting & { readonly act: 'forget' })
  | (HeldThroughACall & { readonly act: 'unsubscribe' })
  | (Holding & { readonly act: 'replace'; readonly from?: HeldThroughACall })
  | (HeldThroughACall & { readonly act: 'renew'; readonly destination: Renewable })
  | (HeldThroughACall & { readonly act: 'resubscribe'; readonly gone: boolean })
  | (Calling & { readonly act: 'subscribe' })
  | (HeldByPolling & { readonly act: 'read' })
  | (Acting & { readonly act: 'refuse'; readonly failure: RecordedFailure });

export interface Decision {
  readonly steps: readonly Step[];
  readonly nextDueAt?: number;
}

type Slot = 'none' | 'wanted' | 'unwanted';

interface Judgement {
  readonly slot: Slot;
  readonly step?: Step;
  readonly at?: number | undefined;
  readonly candidate?: Calling;
  readonly frees?: number | undefined;
}

interface Judging {
  readonly row: RecordedSubscription;
  readonly made: MadeSubscription;
  readonly state: ConnectionState | undefined;
  readonly now: number;
}

const { kind, because } = failedBecause('not_sent');

const pastTheBound: RecordedFailure = { kind, because };

const actsInOrder: readonly Step['act'][] = [
  'forget',
  'unsubscribe',
  'replace',
  'renew',
  'resubscribe',
  'subscribe',
  'read',
  'refuse',
];

function hasLapsed(positions: Positions | undefined, now: number): boolean {
  return positions?.lapsesAt !== undefined && positions.lapsesAt <= now;
}

function isDue(positions: Positions | undefined, destination: Arranging, now: number): boolean {
  if (positions === undefined) {
    return lapses(destination);
  }
  return positions.dueAt !== undefined && positions.dueAt <= now;
}

function forgotten(row: RecordedSubscription): Judgement {
  return { slot: 'none', step: { act: 'forget', key: keyIn(row), recorded: row } };
}

function missingJudged(key: SubscriptionKey, row: RecordedSubscription | undefined, through: Through, now: number) {
  const positions = row?.positions;
  if (isHeldBy(row?.failed, through.generation)) {
    return { slot: 'none' } satisfies Judgement;
  }
  if (isWaitingToRetry(positions, now)) {
    return { slot: 'none', at: positions?.dueAt } satisfies Judgement;
  }
  return { slot: 'none', candidate: { key: keyIn(key), recorded: row, ...through } } satisfies Judgement;
}

function unwantedJudged({ row, made, state, now }: Judging): Judgement {
  const { positions, failed } = row;
  const held = made.type === 'polling' || hasLapsed(positions, now) ? undefined : heldThroughACallOf(row, made, state);
  if (held === undefined) {
    return forgotten(row);
  }
  const lapsesAt = positions?.lapsesAt;
  if (isHeldBy(failed, held.generation)) {
    return { slot: 'unwanted', at: lapsesAt, frees: lapsesAt };
  }
  if (isWaitingToRetry(positions, now)) {
    const at = earliest(positions?.dueAt, lapsesAt);
    return { slot: 'unwanted', at, frees: at };
  }
  return { slot: 'unwanted', frees: now, step: { act: 'unsubscribe', ...held } };
}

function replacedJudged({ row, made, state, now }: Judging, wanted: Through): Judgement {
  const from =
    made.type === 'polling' || hasLapsed(row.positions, now) ? undefined : heldThroughACallOf(row, made, state);
  if (from !== undefined && isHeldBy(row.failed, from.generation)) {
    return { slot: 'wanted' };
  }
  if (isWaitingToRetry(row.positions, now)) {
    return { slot: 'wanted', at: row.positions?.dueAt };
  }
  const replace = { act: 'replace', key: keyIn(row), recorded: row, made, ...wanted } as const;
  return { slot: 'wanted', step: from === undefined ? replace : { ...replace, from } };
}

function dueStepOf(holding: HeldThroughACall): Step {
  const { destination } = holding;
  return destination.renew === undefined
    ? { act: 'resubscribe', gone: false, ...holding }
    : { act: 'renew', ...holding, destination: { ...destination, renew: destination.renew } };
}

function readJudged(held: HeldByPolling, { positions }: RecordedSubscription, now: number): Judgement {
  const dueAt = positions?.dueAt;
  return dueAt === undefined || dueAt <= now
    ? { slot: 'wanted', step: { act: 'read', ...held } }
    : { slot: 'wanted', at: dueAt };
}

function wantedJudged({ row, now }: Judging, held: Held): Judgement {
  const { positions } = row;
  if (isHeldByPolling(held)) {
    return isHeldBy(row.failed, held.generation, holdsARead) ? { slot: 'wanted' } : readJudged(held, row, now);
  }
  if (isHeldBy(row.failed, held.generation)) {
    return { slot: 'wanted' };
  }
  if (hasLapsed(positions, now)) {
    return { slot: 'wanted', step: { act: 'resubscribe', gone: true, ...held } };
  }
  return isDue(positions, held.destination, now)
    ? { slot: 'wanted', step: dueStepOf(held) }
    : { slot: 'wanted', at: earliest(positions?.dueAt, positions?.lapsesAt) };
}

function recordedJudged(row: RecordedSubscription, wanted: Wanted | undefined, situation: Situation): Judgement {
  const { now, connections } = situation;
  const state = connections.get(row.connection);
  const { made } = row;
  if (made === undefined) {
    return wanted === undefined ? forgotten(row) : missingJudged(row, row, throughOf(state, wanted.destination), now);
  }
  const judging = { row, made, state, now };
  if (wanted === undefined) {
    return unwantedJudged(judging);
  }
  const through = throughOf(state, wanted.destination);
  const held = arrangedAs(row, made, through);
  return held === undefined ? replacedJudged(judging, through) : wantedJudged(judging, held);
}

interface Bounded {
  readonly steps: readonly Step[];
  readonly at?: number | undefined;
}

function candidatesIn(connection: readonly Judgement[]): readonly Calling[] {
  return connection
    .flatMap(({ candidate }) => (candidate === undefined ? [] : [candidate]))
    .toSorted((left, right) => (left.key.topic < right.key.topic ? -1 : 1));
}

function boundedOf(connection: readonly Judgement[], most: number): Bounded {
  const room = most - connection.filter(({ slot }) => slot !== 'none').length;
  const roomOnceFreed = most - connection.filter(({ slot }) => slot === 'wanted').length;
  const frees = earliest(...connection.map((judgement) => judgement.frees));
  const candidates = candidatesIn(connection);
  const waits = (rank: number) => rank >= room && rank < roomOnceFreed && frees !== undefined;
  const steps = candidates.flatMap((candidate, rank): readonly Step[] => {
    if (rank < room) {
      return [{ act: 'subscribe', ...candidate }];
    }
    return waits(rank) || isTheSameFailure(candidate.recorded?.failed, pastTheBound)
      ? []
      : [{ act: 'refuse', key: candidate.key, recorded: candidate.recorded, failure: pastTheBound }];
  });
  return { steps, at: candidates.some((_, rank) => waits(rank)) ? frees : undefined };
}

function wantedOnce(wanted: readonly Wanted[]): ReadonlyMap<string, Wanted> {
  return new Map(wanted.map((each) => [keyOf(each), each]));
}

interface Judged {
  readonly connection: string;
  readonly judgement: Judgement;
}

function judgedByConnection(situation: Situation): readonly (readonly Judgement[])[] {
  const { recorded, connections, now } = situation;
  const wanted = wantedOnce(situation.wanted);
  const recordedKeys = new Set(recorded.map((row) => keyOf(row)));
  const unrecorded = [...wanted.values()].filter((each) => !recordedKeys.has(keyOf(each)));
  const judged: readonly Judged[] = [
    ...recorded.map((row) => ({
      connection: row.connection,
      judgement: recordedJudged(row, wanted.get(keyOf(row)), situation),
    })),
    ...unrecorded.map((each) => ({
      connection: each.connection,
      judgement: missingJudged(each, undefined, throughOf(connections.get(each.connection), each.destination), now),
    })),
  ];
  const byConnection = [...new Set(judged.map(({ connection }) => connection))];
  return byConnection.map((connection) =>
    judged.filter((each) => each.connection === connection).map(({ judgement }) => judgement),
  );
}

export function decided(situation: Situation): Decision {
  const judged = judgedByConnection(situation);
  const bounded = judged.map((connection) => boundedOf(connection, situation.mostPerConnection));
  const steps = [
    ...judged.flat().flatMap(({ step }) => (step === undefined ? [] : [step])),
    ...bounded.flatMap((byTheBound) => byTheBound.steps),
  ].toSorted((left, right) => actsInOrder.indexOf(left.act) - actsInOrder.indexOf(right.act));
  const nextDueAt = earliest(...judged.flat().map(({ at }) => at), ...bounded.map(({ at }) => at));
  return nextDueAt === undefined ? { steps } : { steps, nextDueAt };
}
