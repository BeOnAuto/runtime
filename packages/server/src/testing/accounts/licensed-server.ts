import { accountFake, accountServerOver, testSigners, type AccountFake } from '@on.auto/meter/testing';
import { onTestFinished } from 'vitest';

import { servingReasoning, type ReasoningServer } from '../servers/reasoning-server.ts';
import type { ServedParts } from '../servers/served-parts.ts';
import { tallyCreated } from '../servers/tally-server.ts';

export const installation = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

export const studio = 'https://studio.example.com';

export interface Accounts {
  readonly account: AccountFake;
  readonly origin: string;
  readonly key: string;
}

export async function accountsServed(): Promise<Accounts> {
  const account = accountFake();
  const served = await accountServerOver(account);
  onTestFinished(() => served.close());
  return { account, origin: served.origin, key: account.keyFor(installation) };
}

export async function servedBy(
  { origin }: Accounts,
  environment: Readonly<Record<string, string>> = {},
  parts: ServedParts = {},
): Promise<ReasoningServer> {
  const settings = { ACCOUNTS_ORIGIN: origin, STUDIO_ORIGIN: studio, ...environment };
  const server = await servingReasoning([], settings, undefined, { signers: testSigners, ...parts });
  const stopping: { done?: Promise<void> } = {};
  const stop = (): Promise<void> => {
    stopping.done ??= server.stop();
    return stopping.done;
  };
  onTestFinished(stop);
  await tallyCreated(server);
  return { ...server, stop };
}
