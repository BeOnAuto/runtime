import type { AppRuntime } from '@on.auto/api';
import { everyoneSignedOut, type ProviderRows } from '@on.auto/openid-connect';
import {
  ActedContextSchema,
  factOf,
  Ledger,
  signedInPersonPrefix,
  type Conflict,
  type Decided,
  type Decider,
  type StreamReader,
  type StreamWriter,
} from '@on.auto/operations';
import { Data, DateTime, Effect, Result, Schema } from 'effect';

import { logRequiredClaimSet, logSetupReopened } from '../logging/sign-in-logging.ts';
import { inRuntime } from '../workflows/in-runtime.ts';

export const setupStream = 'runtime/setup';

const RequiredClaimSetSchema = Schema.Struct({
  issuer: Schema.String,
  claim: Schema.String,
  value: Schema.String,
  person: Schema.String,
});

export const SetupEventSchema = Schema.Union([
  factOf('required_claim_set', RequiredClaimSetSchema, ActedContextSchema),
  factOf('setup_reopened', Schema.Struct({}), ActedContextSchema),
]);

type SetupEvent = typeof SetupEventSchema.Type;

export type RequiredClaimSet = typeof RequiredClaimSetSchema.Type;

type InForce = RequiredClaimSet | undefined;

interface Acted {
  readonly at: string;
  readonly by: string;
}

interface Tie extends Acted {
  readonly kind: 'tie';
  readonly set: RequiredClaimSet;
}

interface Reopen extends Acted {
  readonly kind: 'reopen';
}

type SetupCommand = Tie | Reopen;

function decidedAgainst(command: SetupCommand, inForce: InForce): readonly Decided<SetupEvent>[] {
  if (command.kind === 'tie') {
    return inForce === undefined ? [{ type: 'required_claim_set', data: command.set }] : [];
  }
  return inForce === undefined ? [] : [{ type: 'setup_reopened', data: {} }];
}

export const setupDecider: Decider<InForce, SetupCommand, SetupEvent> = {
  initialState: undefined,
  evolve: (_inForce, fact) => (fact.type === 'required_claim_set' ? fact.data : undefined),
  decide: (command, inForce) => Result.succeed(decidedAgainst(command, inForce)),
  context: ({ by, at }) => ({ by, at }),
  eventSchema: SetupEventSchema,
};

export interface SetupServices {
  readonly registry: StreamReader & StreamWriter;
}

type Refused = Readonly<Pick<Conflict, '_tag' | 'detail' | 'kind'>>;

function inForceAfter({ registry }: SetupServices, refused: Refused): Effect.Effect<RequiredClaimSet, Refused> {
  return Effect.flatMap(registry.load(setupStream, setupDecider), ({ state }) =>
    state === undefined ? Effect.fail(refused) : Effect.succeed(state),
  );
}

export function requiredClaimSetBy(
  services: SetupServices,
  asked: RequiredClaimSet,
): Effect.Effect<RequiredClaimSet, Refused> {
  return Effect.gen(function* () {
    const at = DateTime.formatIso(yield* DateTime.now);
    const tie: Tie = { kind: 'tie', set: asked, at, by: `${signedInPersonPrefix}${asked.person}` };
    return yield* services.registry.execute(setupStream, setupDecider, tie).pipe(
      Effect.flatMap(({ decidedOn }) =>
        decidedOn === undefined
          ? Effect.as(logRequiredClaimSet(asked.issuer, asked.claim, asked.person), asked)
          : Effect.succeed(decidedOn),
      ),
      Effect.catchTag('conflict', (refused: Refused) => inForceAfter(services, refused)),
    );
  });
}

export interface Reopening extends SetupServices {
  readonly providerRows: Pick<ProviderRows, 'endedEvery'>;
}

export class SignOutUnconfirmed extends Data.TaggedError('SignOutUnconfirmed')<{ readonly message: string }> {}

function everyoneSignedOutOf(providerRows: Reopening['providerRows']): Effect.Effect<void, SignOutUnconfirmed> {
  return Effect.tryPromise({
    try: () => everyoneSignedOut(providerRows),
    catch: (failure) => new SignOutUnconfirmed({ message: String(Reflect.get(new Object(failure), 'message')) }),
  });
}

export function setupReopened(
  { registry, providerRows }: Reopening,
  by: string,
): Effect.Effect<boolean, Conflict | SignOutUnconfirmed> {
  return Effect.gen(function* () {
    const at = DateTime.formatIso(yield* DateTime.now);
    const { version: factsOfTheSetup } = yield* registry.execute(setupStream, setupDecider, { kind: 'reopen', at, by });
    if (factsOfTheSetup === 0) {
      return false;
    }
    yield* everyoneSignedOutOf(providerRows);
    yield* logSetupReopened;
    return true;
  });
}

type SetupAnswer = RequiredClaimSet | { readonly failed: string };

export interface Setup {
  readonly requiredClaimSet: (asked: RequiredClaimSet) => Promise<SetupAnswer>;
}

function answeredFor(asked: RequiredClaimSet): Effect.Effect<SetupAnswer, never, Ledger> {
  return Effect.flatMap(Effect.service(Ledger), (registry) =>
    requiredClaimSetBy({ registry }, asked).pipe(
      Effect.catchTag('conflict', ({ detail }: Refused) => Effect.succeed<SetupAnswer>({ failed: detail })),
    ),
  );
}

export function setupIn(runtime: AppRuntime<Ledger>): Setup {
  return {
    requiredClaimSet: (asked) => Effect.runPromise(inRuntime(runtime, answeredFor(asked))),
  };
}
