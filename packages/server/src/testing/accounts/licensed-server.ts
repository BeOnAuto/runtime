import { accountFake, accountServerOver, testSigners, type AccountFake } from '@on.auto/meter/testing';
import type { ScriptedReplies } from '@on.auto/reasoning/testing';
import { Effect, Schema } from 'effect';
import { onTestFinished } from 'vitest';

import { servingReasoning, type ReasoningServer } from '../servers/reasoning-server.ts';
import type { ServedParts } from '../servers/served-parts.ts';
import { tallyCreated } from '../servers/tally-server.ts';
import { until } from '../waiting/until.ts';

export const installation = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

export const studio = 'https://studio.example.com';

export interface Accounts {
  readonly account: AccountFake;
  readonly origin: string;
  readonly key: string;
  readonly reportsAsked: () => number;
}

function withItsReportsCounted(account: AccountFake, counted: () => void): AccountFake {
  return {
    ...account,
    ports: {
      ...account.ports,
      report: (key, usage) =>
        Effect.suspend(() => {
          counted();
          return account.ports.report(key, usage);
        }),
    },
  };
}

export async function accountsServed(): Promise<Accounts> {
  const account = accountFake();
  const asked = { reports: 0 };
  const served = await accountServerOver(
    withItsReportsCounted(account, () => {
      asked.reports += 1;
    }),
  );
  onTestFinished(() => served.close());
  return { account, origin: served.origin, key: account.keyFor(installation), reportsAsked: () => asked.reports };
}

export async function servedBy(
  { origin }: Accounts,
  environment: Readonly<Record<string, string>> = {},
  parts: ServedParts = {},
  replies: readonly ScriptedReplies[] = [],
): Promise<ReasoningServer> {
  const settings = { ACCOUNTS_ORIGIN: origin, STUDIO_ORIGIN: studio, ...environment };
  const server = await servingReasoning(replies, settings, undefined, { signers: testSigners, ...parts });
  const stopping: { done?: Promise<void> } = {};
  const stop = (): Promise<void> => {
    stopping.done ??= server.stop();
    return stopping.done;
  };
  onTestFinished(stop);
  await tallyCreated(server);
  return { ...server, stop };
}

const standingIn = Schema.decodeUnknownSync(
  Schema.Struct({ runtime_id: Schema.String, state: Schema.String, licensed: Schema.Number }),
);

export async function standingOf(server: Pick<ReasoningServer, 'call'>) {
  return standingIn((await server.call('GET', '/v1/orgs/acme/license')).body);
}

export async function runtimeIdOf(server: Pick<ReasoningServer, 'call'>): Promise<string> {
  return (await standingOf(server)).runtime_id;
}

export async function licensedServedBy(
  accounts: Accounts,
  environment: Readonly<Record<string, string>> = {},
  parts: ServedParts = {},
  replies: readonly ScriptedReplies[] = [],
): Promise<ReasoningServer> {
  const server = await servedBy(accounts, environment, parts, replies);
  await until(
    () => standingOf(server),
    ({ state }) => state === 'licensed',
  );
  return server;
}
