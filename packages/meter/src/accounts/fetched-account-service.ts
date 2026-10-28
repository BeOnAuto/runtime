import { Effect, Layer, Option, Schema } from 'effect';

import { SignedSchema } from '../licensing/signed-answers.ts';
import { AccountFailure, unreachable } from './account-failure.ts';
import {
  ActivationRequestSchema,
  AdmissionRequestSchema,
  AllocationRefreshRequestSchema,
  AllocationReportRequestSchema,
  UsageRequestSchema,
} from './account-requests.ts';
import { AccountService, type AccountPorts } from './account-service.ts';

interface AccountRequest {
  readonly method: 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly signal: Readonly<AbortSignal>;
}

export interface AccountsAt {
  readonly origin: string;
  readonly fetch: (address: string, request: AccountRequest) => Promise<Response>;
}

interface Answer {
  readonly status: number;
  readonly text: string;
}

const accountsAnswerWithinMs = 10_000;

const ActivationSchema = Schema.Struct({ entitlement: SignedSchema, repair: Schema.NullOr(SignedSchema) });

const AdmittedSchema = Schema.Struct({ admission: SignedSchema });

const TakenSchema = Schema.Struct({ taken: Schema.Literal(true) });

const AllocationSchema = Schema.Struct({ allocation: SignedSchema });

const AllocationTakenSchema = Schema.Struct({ taken: Schema.String });

const RefusalSchema = Schema.Struct({
  kind: Schema.optionalKey(Schema.String),
  detail: Schema.optionalKey(Schema.String),
  because: Schema.optionalKey(Schema.String),
  resolve_at: Schema.optionalKey(Schema.String),
});

const refusalIn = Schema.decodeUnknownOption(Schema.fromJsonString(RefusalSchema));

const unworded: typeof RefusalSchema.Type = {};

type Request<S extends Schema.Top> = (body: S['Type']) => Effect.Effect<string, AccountFailure>;

function requestOf<S extends Schema.Codec<unknown, unknown>>(schema: S): Request<S> {
  const encoded = Schema.encodeEffect(Schema.fromJsonString(schema));
  return (body) =>
    encoded(body).pipe(
      Effect.mapError(() => unreachable('The runtime sends the account service only the fields its call names')),
    );
}

const activationRequest = requestOf(ActivationRequestSchema);

const admissionRequest = requestOf(AdmissionRequestSchema);

const usageRequest = requestOf(UsageRequestSchema);

const allocationRefreshRequest = requestOf(AllocationRefreshRequestSchema);

const allocationReportRequest = requestOf(AllocationReportRequestSchema);

function asked(
  at: AccountsAt,
  path: string,
  key: string,
  request: Effect.Effect<string, AccountFailure>,
): Effect.Effect<Answer, AccountFailure> {
  return Effect.flatMap(request, (body) =>
    Effect.tryPromise({
      try: async (signal) => {
        const response = await at.fetch(`${at.origin}${path}`, {
          method: 'POST',
          headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
          body,
          signal: AbortSignal.any([signal, AbortSignal.timeout(accountsAnswerWithinMs)]),
        });
        return { status: response.status, text: await response.text() };
      },
      catch: (cause) => unreachable(`The account service at ${at.origin} could not be asked: ${String(cause)}`),
    }),
  );
}

function refusalOf({ status, text }: Answer): AccountFailure {
  const {
    kind = 'unknown',
    detail = `The account service answered ${status}`,
    ...resolution
  } = Option.getOrElse(refusalIn(text), () => unworded);
  return new AccountFailure({ status, kind, detail, ...resolution });
}

function answerIn<S extends Schema.Codec<unknown, unknown>>(
  schema: S,
): (answer: Answer) => Effect.Effect<S['Type'], AccountFailure> {
  const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(schema));
  return (answer) => {
    if (answer.status < 200 || answer.status > 299) {
      return Effect.fail(refusalOf(answer));
    }
    return Option.match(decoded(answer.text), {
      onNone: () => Effect.fail(unreachable('The account service answered in a shape the runtime does not know')),
      onSome: Effect.succeed,
    });
  };
}

const activationIn = answerIn(ActivationSchema);

const admittedIn = answerIn(AdmittedSchema);

const takenIn = answerIn(TakenSchema);

const allocationIn = answerIn(AllocationSchema);

const allocationTakenIn = answerIn(AllocationTakenSchema);

export function accountServiceAt(at: AccountsAt): AccountPorts {
  return {
    activate: (key, usage) =>
      Effect.flatMap(asked(at, '/v1/installations/activate', key, activationRequest(usage)), activationIn),
    admit: (key, action) =>
      asked(at, '/v1/installations/actions', key, admissionRequest({ action })).pipe(
        Effect.flatMap(admittedIn),
        Effect.map(({ admission }) => admission),
      ),
    report: (key, usage) =>
      asked(at, '/v1/installations/reports', key, usageRequest(usage)).pipe(Effect.flatMap(takenIn), Effect.asVoid),
    refreshAllocation: (key, id) =>
      asked(at, '/v1/installations/allocations/refresh', key, allocationRefreshRequest({ allocation: id })).pipe(
        Effect.flatMap(allocationIn),
        Effect.map(({ allocation }) => allocation),
      ),
    reportAllocation: (key, report) =>
      asked(at, '/v1/installations/allocations/report', key, allocationReportRequest(report)).pipe(
        Effect.flatMap(allocationTakenIn),
        Effect.map(({ taken }) => taken),
      ),
  };
}

export function accountServiceLayer(at: AccountsAt): Layer.Layer<AccountService> {
  return Layer.succeed(AccountService, AccountService.of(accountServiceAt(at)));
}
