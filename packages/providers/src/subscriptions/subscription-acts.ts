import type { PlaybookAddress } from '@on.auto/operations';
import { Effect, Option, Redacted, Ref, Result } from 'effect';

import { waitAfter } from '../sockets/socket-listening.ts';
import type { Renewable, Step, Through } from './subscription-decisions.ts';
import { failedBecause, type SubscriptionCallFailed } from './subscription-failed.ts';
import type {
  HeldSubscription,
  KeptSecret,
  MadeSubscription,
  Positions,
  RecordedSubscription,
  SubscriptionCalls,
  SubscriptionKey,
  SubscriptionLoopPorts,
  SubscriptionPlace,
} from './subscription-ports.ts';
import { isLasting, isTheSameFailure, type Arranging } from './subscription-records.ts';

export interface Round {
  readonly ports: SubscriptionLoopPorts;
  readonly calls: SubscriptionCalls;
  readonly playbook: PlaybookAddress;
  readonly now: number;
}

export type Later = readonly number[];

interface Acting extends Through {
  readonly key: SubscriptionKey;
  readonly recorded?: RecordedSubscription | undefined;
}

interface Holding extends Acting {
  readonly recorded: RecordedSubscription;
  readonly made: MadeSubscription;
}

interface Made {
  readonly id: string;
  readonly expiresAt?: string | undefined;
  readonly secretId?: string | undefined;
}

interface Removal {
  readonly removed: boolean;
  readonly later: Later;
}

interface SecretToPlace {
  readonly madeSecret: Effect.Effect<Redacted.Redacted>;
  readonly made: Effect.Effect<Option.Option<KeptSecret>>;
}

type CallFailure = Pick<SubscriptionCallFailed, 'kind' | 'because'>;

const millisOfASecond = 1000;

const renewedHalfwayThrough = 0.5;

const nothingLater: Later = [];

function laterAt(time: number | undefined): Later {
  return time === undefined ? nothingLater : [time];
}

function placeOf({ playbook }: Round, { connection }: SubscriptionKey): SubscriptionPlace {
  return { ...playbook, connection };
}

function heldOf({ made, recorded }: Holding): HeldSubscription {
  const lapsesAt = recorded.positions?.lapsesAt;
  return lapsesAt === undefined ? { id: made.id } : { id: made.id, expiresAt: new Date(lapsesAt).toISOString() };
}

function leaseFrom(now: number, { lease_seconds: leaseSeconds }: Arranging, expiresAt: string | undefined): Positions {
  const declared = leaseSeconds === undefined ? undefined : now + leaseSeconds * millisOfASecond;
  const lapsesAt = expiresAt === undefined ? declared : Date.parse(expiresAt);
  if (lapsesAt === undefined || lapsesAt <= now) {
    return { failures: 0 };
  }
  return { failures: 0, lapsesAt, dueAt: now + (lapsesAt - now) * renewedHalfwayThrough };
}

function forgottenSecret(round: Round, key: SubscriptionKey, secretId: string | undefined): Effect.Effect<void> {
  return secretId === undefined ? Effect.void : round.ports.secrets.forget(placeOf(round, key), secretId);
}

function forgotten(round: Round, key: SubscriptionKey, made: MadeSubscription | undefined): Effect.Effect<void> {
  return round.ports.records
    .removed(round.playbook, key)
    .pipe(Effect.andThen(forgottenSecret(round, key, made?.secretId)));
}

function moved(round: Round, key: SubscriptionKey, positions: Positions): Effect.Effect<Later> {
  return Effect.as(round.ports.records.moved(round.playbook, key, positions), laterAt(positions.dueAt));
}

function withLapse(positions: Positions, lapsesAt: number | undefined): Positions {
  return lapsesAt === undefined ? positions : { ...positions, lapsesAt };
}

function failedOn(round: Round, acting: Acting, { kind, because }: CallFailure, recordsWhatPasses: boolean) {
  const { key, recorded, generation } = acting;
  const lasting = isLasting(kind);
  const failed = { kind, because, attempted: generation };
  const failures = recorded?.positions?.failures ?? 0;
  const lapsesAt = recorded?.positions?.lapsesAt;
  return Effect.gen(function* () {
    if ((lasting || recordsWhatPasses) && !isTheSameFailure(recorded?.failed, failed)) {
      yield* round.ports.records.failed(round.playbook, key, failed);
    }
    if (lasting) {
      yield* round.ports.records.moved(round.playbook, key, withLapse({ failures: 0, dueAt: round.now }, lapsesAt));
      return laterAt(lapsesAt);
    }
    const waitMs = yield* waitAfter(failures);
    return yield* moved(round, key, withLapse({ failures: failures + 1, dueAt: round.now + waitMs }, lapsesAt));
  });
}

function secretToPlace(
  round: Round,
  place: SubscriptionPlace,
  held: MadeSubscription | undefined,
): Effect.Effect<SecretToPlace> {
  const { secrets } = round.ports;
  return Effect.gen(function* () {
    const made = yield* Ref.make(Option.none<KeptSecret>());
    const madeSecret = Effect.gen(function* () {
      const reused = held?.secretId === undefined ? undefined : yield* secrets.read(place, held.secretId);
      if (reused !== undefined) {
        return reused;
      }
      const kept = yield* secrets.make(place);
      yield* Ref.set(made, Option.some(kept));
      return kept.secret;
    });
    return { madeSecret, made: Ref.get(made) };
  });
}

function answeredSecretId(
  round: Round,
  place: SubscriptionPlace,
  answered: Redacted.Redacted,
  held: MadeSubscription | undefined,
): Effect.Effect<string> {
  const { secrets } = round.ports;
  return Effect.gen(function* () {
    const heldId = held?.secretId;
    if (heldId !== undefined) {
      const before = yield* secrets.read(place, heldId);
      if (before !== undefined && Redacted.value(before) === Redacted.value(answered)) {
        return heldId;
      }
    }
    return yield* secrets.keep(place, answered);
  });
}

interface Subscribing {
  readonly key: SubscriptionKey;
  readonly destination: Arranging;
  readonly held?: MadeSubscription | undefined;
}

function droppedAtOnce(round: Round, { key, destination }: Subscribing, id: string): Effect.Effect<void> {
  const asked = { destination, place: placeOf(round, key), topic: key.topic, subscription: { id } };
  return Effect.ignore(round.calls.unsubscribe(asked));
}

function subscribedThrough(round: Round, subscribing: Subscribing): Effect.Effect<Made, SubscriptionCallFailed> {
  const { key, destination, held } = subscribing;
  const place = placeOf(round, key);
  return Effect.gen(function* () {
    const { madeSecret, made } = yield* secretToPlace(round, place, held);
    const answered = yield* Effect.result(round.calls.subscribe({ destination, place, topic: key.topic, madeSecret }));
    const madeId = Option.getOrUndefined(yield* made)?.id;
    if (Result.isFailure(answered)) {
      yield* forgottenSecret(round, key, madeId);
      return yield* Effect.fail(answered.failure);
    }
    const { id, expiresAt, secret } = answered.success;
    if (!round.ports.records.holds(id)) {
      yield* forgottenSecret(round, key, madeId);
      yield* droppedAtOnce(round, subscribing, id);
      return yield* failedBecause('unreadable');
    }
    if (secret === undefined) {
      return { id, expiresAt };
    }
    const secretId =
      secret === 'made' ? (madeId ?? held?.secretId) : yield* answeredSecretId(round, place, secret.answered, held);
    return { id, expiresAt, secretId };
  });
}

function madeOf({ destination, generation }: Through, { id, secretId }: Made): MadeSubscription {
  const made = { type: destination.type, id, declared: generation.declared };
  return secretId === undefined ? made : { ...made, secretId };
}

function subscribed(round: Round, acting: Acting): Effect.Effect<Later> {
  const { key, destination } = acting;
  return Effect.matchEffect(subscribedThrough(round, { key, destination }), {
    onFailure: (failure: CallFailure) => failedOn(round, acting, failure, true),
    onSuccess: (made) =>
      round.ports.records
        .made(round.playbook, key, madeOf(acting, made))
        .pipe(Effect.andThen(moved(round, key, leaseFrom(round.now, destination, made.expiresAt)))),
  });
}

type Resubscribing = Holding & { readonly gone: boolean };

function replacedBy(round: Round, holding: Resubscribing, made: Made): Effect.Effect<void> {
  const { key, gone, destination, made: before } = holding;
  return Effect.gen(function* () {
    if (!gone && before.id !== made.id) {
      yield* droppedAtOnce(round, { key, destination }, before.id);
    }
    yield* round.ports.records.removed(round.playbook, key);
    yield* round.ports.records.made(round.playbook, key, madeOf(holding, made));
    if (before.secretId !== made.secretId) {
      yield* forgottenSecret(round, key, before.secretId);
    }
  });
}

function resubscribed(round: Round, holding: Resubscribing): Effect.Effect<Later> {
  const { key, destination, made: held } = holding;
  return Effect.matchEffect(subscribedThrough(round, { key, destination, held }), {
    onFailure: (failure: CallFailure) => failedOn(round, holding, failure, false),
    onSuccess: (made) => {
      const lease = moved(round, key, leaseFrom(round.now, destination, made.expiresAt));
      const isARenewal = made.id === held.id && made.secretId === held.secretId;
      return isARenewal ? lease : Effect.andThen(replacedBy(round, holding, made), lease);
    },
  });
}

function isForWantOfTheLeasesEnd({ because }: CallFailure, { recorded }: Holding): boolean {
  return because === 'not_sent' && recorded.positions?.lapsesAt === undefined;
}

function renewed(round: Round, holding: Holding & { readonly destination: Renewable }): Effect.Effect<Later> {
  const { key, destination } = holding;
  const asked = { destination, place: placeOf(round, key), topic: key.topic, subscription: heldOf(holding) };
  return Effect.matchEffect(round.calls.renew(asked), {
    onFailure: (failure: CallFailure) =>
      isForWantOfTheLeasesEnd(failure, holding)
        ? resubscribed(round, { ...holding, gone: false })
        : failedOn(round, holding, failure, false),
    onSuccess: ({ expiresAt }) => moved(round, key, leaseFrom(round.now, destination, expiresAt)),
  });
}

function unsubscribedThrough(round: Round, holding: Holding, through: Through): Effect.Effect<Removal> {
  const { key, made } = holding;
  const { destination } = through;
  const asked = { destination, place: placeOf(round, key), topic: key.topic, subscription: heldOf(holding) };
  return Effect.matchEffect(round.calls.unsubscribe(asked), {
    onFailure: (failure: CallFailure) =>
      Effect.map(failedOn(round, { ...holding, ...through }, failure, false), (later) => ({ removed: false, later })),
    onSuccess: () => Effect.as(forgotten(round, key, made), { removed: true, later: nothingLater }),
  });
}

function replaced(round: Round, holding: Holding & { readonly from?: Through }): Effect.Effect<Later> {
  const { key, made, from, destination, generation } = holding;
  const removal =
    from === undefined
      ? Effect.as(forgotten(round, key, made), { removed: true, later: nothingLater })
      : unsubscribedThrough(round, holding, from);
  return Effect.flatMap(removal, ({ removed, later }: Removal) =>
    removed ? subscribed(round, { key, destination, generation }) : Effect.succeed(later),
  );
}

export function actedOn(round: Round, step: Step): Effect.Effect<Later> {
  if (step.act === 'forget') {
    return Effect.as(forgotten(round, step.key, step.recorded?.made), nothingLater);
  }
  if (step.act === 'refuse') {
    return Effect.as(round.ports.records.failed(round.playbook, step.key, step.failure), nothingLater);
  }
  if (step.act === 'unsubscribe') {
    return Effect.map(unsubscribedThrough(round, step, step), ({ later }: Removal) => later);
  }
  if (step.act === 'replace') {
    return replaced(round, step);
  }
  if (step.act === 'renew') {
    return renewed(round, step);
  }
  return step.act === 'resubscribe' ? resubscribed(round, step) : subscribed(round, step);
}
