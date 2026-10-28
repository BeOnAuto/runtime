import type { KeyCommandConsole } from '@on.auto/identity';
import { SignedSchema } from '@on.auto/meter';
import { Effect, Option, Schema } from 'effect';

import { dayOf, licensedToOf, offlineCreditsNotice } from '../licensing/license-notice.ts';
import { runtimeAddressOf, whenRunning, type RuntimeFetch } from './runtime-probe.ts';

interface RuntimeAsking {
  readonly fetch: RuntimeFetch;
  readonly console: KeyCommandConsole;
}

type LicenseCommand = (port: number, asking: RuntimeAsking) => Effect.Effect<number>;

interface Asking<A> {
  readonly path: string;
  readonly body: object;
  readonly answerIn: (text: string) => Option.Option<A>;
  readonly said: (answer: A) => string;
  readonly failed: string;
}

const askedWithinMs = 30_000;

const licensedIn = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      installation: Schema.String,
      org: Schema.String,
      org_name: Schema.optionalKey(Schema.NullOr(Schema.String)),
      plan: Schema.String,
      expires_at: Schema.String,
    }),
  ),
);

const allocationIn = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      allocation: Schema.String,
      installation: Schema.String,
      credits: Schema.Number,
      spent: Schema.Number,
      refresh_by: Schema.String,
    }),
  ),
);

const reportIn = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ report: Schema.Unknown, signature: Schema.String })),
);

const signedIn = Schema.decodeUnknownOption(Schema.fromJsonString(SignedSchema));

const refusalIn = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Struct({ detail: Schema.String })));

interface Answer {
  readonly status: number;
  readonly text: string;
}

function asked(port: number, { path, body }: Pick<Asking<unknown>, 'path' | 'body'>, asking: RuntimeAsking) {
  return Effect.promise(async (signal): Promise<Answer> => {
    try {
      const response = await asking.fetch(`${runtimeAddressOf(port)}/v1/orgs/local${path}`, {
        method: 'POST',
        timeoutMs: askedWithinMs,
        signal,
        body: JSON.stringify(body),
      });
      return { status: response.status, text: await response.text() };
    } catch (failure) {
      return { status: 0, text: JSON.stringify({ detail: `Auto Runtime did not answer: ${String(failure)}` }) };
    }
  });
}

function told<A>(answer: Answer, ask: Asking<A>, asking: RuntimeAsking): number {
  const answered = Option.filter(ask.answerIn(answer.text), () => answer.status === 200);
  if (Option.isSome(answered)) {
    asking.console.log(ask.said(answered.value));
    return 0;
  }
  const { detail } = Option.getOrElse(refusalIn(answer.text), () => ({ detail: `It answered ${answer.status}` }));
  asking.console.error(`${ask.failed}: ${detail}`);
  return 1;
}

function ran<A>(ask: Asking<A>): LicenseCommand {
  return (port, asking) =>
    whenRunning(port, asking, () => Effect.map(asked(port, ask, asking), (answer) => told(answer, ask, asking)));
}

function activation(key: string): LicenseCommand {
  return ran({
    path: '/license',
    body: { key },
    answerIn: licensedIn,
    said: ({ org, org_name: orgName, plan, installation, expires_at: expiresAt }) =>
      `Licensed to ${licensedToOf(org, orgName)} (${plan} plan) until ${dayOf(expiresAt)}; renews daily. Runtime id ${installation}.`,
    failed: 'Auto Runtime did not activate the key',
  });
}

function allocationGiven(text: string): LicenseCommand {
  return Option.match(signedIn(text), {
    onNone: () => (_port, asking) =>
      Effect.sync(() => {
        asking.console.error(
          'An allocation is the JSON an operator of Auto signed, {"payload":"…","signature":"…","kid":"…"}, given whole as one argument',
        );
        return 1;
      }),
    onSome: (allocation) =>
      ran({
        path: '/license/allocation',
        body: { allocation },
        answerIn: allocationIn,
        said: ({ credits, spent, refresh_by: refreshBy }) =>
          `${offlineCreditsNotice({ credits, spent, usable_until: refreshBy })}.`,
        failed: 'Auto Runtime did not take the allocation',
      }),
  });
}

const report: LicenseCommand = ran({
  path: '/license/allocation/report',
  body: {},
  answerIn: reportIn,
  said: (made) => JSON.stringify(made),
  failed: 'Auto Runtime made no report',
});

const licenseCommands: ReadonlyMap<string, (given: string) => LicenseCommand> = new Map([
  ['activate 3', activation],
  ['allocation 3', allocationGiven],
  ['report 2', () => report],
]);

export function licenseCommandOf(length: number, verb: string, given: string): LicenseCommand | undefined {
  return Option.getOrUndefined(
    Option.map(Option.fromNullishOr(licenseCommands.get(`${verb} ${length}`)), (command) => command(given)),
  );
}
