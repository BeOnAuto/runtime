import { Effect, Option, Result } from 'effect';

import { startedOn } from '../checks/check-starts.ts';
import { readOn } from '../checks/check-walks.ts';
import type { HeldThroughACall, Through } from './held-subscriptions.ts';
import type { Renewable, Step } from './subscription-decisions.ts';
import { failedBecause, type SubscriptionCallFailed } from './subscription-failed.ts';
import type { HeldSubscription, MadeSubscription, MadeThroughACall, SubscriptionKey } from './subscription-ports.ts';
import { isPolled, keyOf, leaseFrom, type Arranging } from './subscription-records.ts';
import {
  aCallOnWhatIsMade,
  aSubscribe,
  aSubscribeAgain,
  aSubscribeNotSent,
  failedOn,
  moved,
  nothingLater,
  placeOf,
  type Acting,
  type CallFailure,
  type Later,
  type Round,
} from './subscription-retries.ts';
import { answeredSecretId, secretToPlace } from './subscription-secrets.ts';

interface Made {
  readonly id: string;
  readonly expiresAt?: string | undefined;
  readonly secretId?: string | undefined;
}

interface Removal {
  readonly removed: boolean;
  readonly later: Later;
}

function connectionIdOf({ connections }: Round, { connection }: SubscriptionKey): string {
  return Option.getOrThrow(Option.fromNullishOr(connections.get(connection))).id;
}

function heldOf({ made, recorded }: HeldThroughACall): HeldSubscription {
  const lapsesAt = recorded.positions?.lapsesAt;
  return lapsesAt === undefined ? { id: made.id } : { id: made.id, expiresAt: new Date(lapsesAt).toISOString() };
}

function forgottenSecret(round: Round, key: SubscriptionKey, secretId: string | undefined): Effect.Effect<void> {
  return secretId === undefined ? Effect.void : round.ports.secrets.forget(placeOf(round, key), secretId);
}

function secretIdOf(made: MadeSubscription | undefined): string | undefined {
  return made === undefined || made.type === 'polling' ? undefined : made.secretId;
}

function forgotten(round: Round, key: SubscriptionKey, made: MadeSubscription | undefined): Effect.Effect<void> {
  return round.ports.records
    .removed(round.playbook, key)
    .pipe(Effect.andThen(forgottenSecret(round, key, secretIdOf(made))));
}

interface Subscribing {
  readonly key: SubscriptionKey;
  readonly destination: Arranging;
  readonly held?: MadeThroughACall | undefined;
}

function droppedAtOnce(round: Round, { key, destination }: Subscribing, id: string): Effect.Effect<void> {
  const asked = { destination, place: placeOf(round, key), topic: key.topic, subscription: { id } };
  return Effect.ignore(round.calls.unsubscribe(asked));
}

function subscribedThrough(round: Round, subscribing: Subscribing): Effect.Effect<Made, SubscriptionCallFailed> {
  const { key, destination, held } = subscribing;
  const place = placeOf(round, key);
  return Effect.gen(function* () {
    const connectionId = connectionIdOf(round, key);
    const { madeSecret, made } = yield* secretToPlace(round.ports.secrets, place, held);
    const asked = { destination, place, topic: key.topic, connectionId, madeSecret };
    const answered = yield* Effect.result(round.calls.subscribe(asked));
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
      secret === 'made'
        ? (madeId ?? held?.secretId)
        : yield* answeredSecretId(round.ports.secrets, place, secret.answered, held);
    return { id, expiresAt, secretId };
  });
}

interface ArrangedThrough {
  readonly destination: Arranging;
  readonly generation: Through['generation'];
}

function madeOf({ destination, generation }: ArrangedThrough, { id, secretId }: Made): MadeThroughACall {
  const made = { type: destination.type, id, declared: generation.declared };
  return secretId === undefined ? made : { ...made, secretId };
}

function subscribed(round: Round, acting: Acting): Effect.Effect<Later> {
  const { key, destination, generation } = acting;
  const unread = round.unreadFor.get(keyOf(key));
  if (unread !== undefined) {
    return failedOn(round, acting, unread, aSubscribeNotSent);
  }
  if (isPolled(destination)) {
    return startedOn(round, { ...acting, destination });
  }
  return Effect.matchEffect(subscribedThrough(round, { key, destination }), {
    onFailure: (failure: CallFailure) => failedOn(round, acting, failure, aSubscribe),
    onSuccess: (made) =>
      round.ports.records
        .made(round.playbook, key, madeOf({ destination, generation }, made))
        .pipe(Effect.andThen(moved(round, key, leaseFrom(round.now, destination, made.expiresAt)))),
  });
}

type Resubscribing = HeldThroughACall & { readonly gone: boolean };

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
    onFailure: (failure: CallFailure) => failedOn(round, holding, failure, aSubscribeAgain),
    onSuccess: (made) => {
      const lease = moved(round, key, leaseFrom(round.now, destination, made.expiresAt));
      const isARenewal = made.id === held.id && made.secretId === held.secretId;
      return isARenewal ? lease : Effect.andThen(replacedBy(round, holding, made), lease);
    },
  });
}

function isForWantOfTheLeasesEnd({ because }: CallFailure, { recorded }: HeldThroughACall): boolean {
  return because === 'not_sent' && recorded.positions?.lapsesAt === undefined;
}

function renewed(round: Round, holding: HeldThroughACall & { readonly destination: Renewable }): Effect.Effect<Later> {
  const { key, destination } = holding;
  const asked = { destination, place: placeOf(round, key), topic: key.topic, subscription: heldOf(holding) };
  return Effect.matchEffect(round.calls.renew(asked), {
    onFailure: (failure: CallFailure) =>
      isForWantOfTheLeasesEnd(failure, holding)
        ? resubscribed(round, { ...holding, gone: false })
        : failedOn(round, holding, failure, aCallOnWhatIsMade),
    onSuccess: ({ expiresAt }) => moved(round, key, leaseFrom(round.now, destination, expiresAt)),
  });
}

function removalDone(round: Round, { key, made }: Pick<Acting, 'key'> & { readonly made: MadeSubscription }) {
  return Effect.as(forgotten(round, key, made), { removed: true, later: nothingLater } satisfies Removal);
}

function removalHeld(round: Round, acting: Acting, failure: CallFailure): Effect.Effect<Removal> {
  return Effect.map(failedOn(round, acting, failure, aCallOnWhatIsMade), (later) => ({ removed: false, later }));
}

function unsubscribedThrough(round: Round, holding: HeldThroughACall, forgetsARefusal: boolean) {
  const { key, destination } = holding;
  const asked = { destination, place: placeOf(round, key), topic: key.topic };
  return Effect.matchEffect(round.calls.unsubscribe({ ...asked, subscription: heldOf(holding) }), {
    onFailure: (failure: CallFailure) =>
      forgetsARefusal && failure.kind === 'tool_error'
        ? removalDone(round, holding)
        : removalHeld(round, holding, failure),
    onSuccess: () => removalDone(round, holding),
  });
}

type Replacing = Extract<Step, { readonly act: 'replace' }>;

function replaced(round: Round, holding: Replacing): Effect.Effect<Later> {
  const { key, from, destination, generation } = holding;
  const removal = from === undefined ? removalDone(round, holding) : unsubscribedThrough(round, from, false);
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
    return Effect.map(unsubscribedThrough(round, step, true), ({ later }: Removal) => later);
  }
  if (step.act === 'replace') {
    return replaced(round, step);
  }
  if (step.act === 'renew') {
    return renewed(round, step);
  }
  if (step.act === 'read') {
    return readOn(round, step);
  }
  return step.act === 'resubscribe' ? resubscribed(round, step) : subscribed(round, step);
}
