import { Effect } from 'effect';
import { afterEach } from 'vitest';

import type { CalledOnce } from '../one-call/called-once.ts';
import { describedAccess } from '../testing/reporting-access.ts';
import { serveFakeApi, type FakeApiOptions, type FakeApiServer } from '../testing/served-fakes.ts';

export const apiKey = 'graph-api-key-4f1d9a7c2b';

export const clientSecret = 'graph-client-secret-81c2';

export const apiTiming = { callMs: 20_000, openMs: 20_000, longestRetryWaitMs: 1000 };

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

export async function fakeApi(options: FakeApiOptions = {}): Promise<FakeApiServer> {
  const fake = await serveFakeApi({ key: apiKey, ...options });
  closing.push(fake.close);
  return fake;
}

export async function accessTo(entry: Readonly<Record<string, unknown>>) {
  const reporting = await describedAccess(
    { graph: { org: 'acme', ...entry } },
    { environment: { GRAPH_API_KEY: apiKey, GRAPH_CLIENT_SECRET: clientSecret }, timing: apiTiming },
  );
  closing.push(reporting.access.close);
  return reporting.access;
}

export function closedAfter(close: () => Promise<void>): void {
  closing.push(close);
}

export function keyed(fake: FakeApiServer) {
  return { document: fake.documentUrl, security: { apiKeyAuth: '${GRAPH_API_KEY}' } };
}

export function called(
  access: Awaited<ReturnType<typeof accessTo>>,
  tool: string,
  input: Readonly<Record<string, unknown>> = {},
): Promise<CalledOnce> {
  return Effect.runPromise(
    access.callOnce({
      org: 'acme',
      playbook: 'alpha',
      reference: { server: 'graph', tool },
      input,
      meta: { 'auto.on/run_id': 'run-1' },
    }),
  );
}

export function answerOf(answered: CalledOnce): unknown {
  return 'answer' in answered ? answered.answer : answered;
}
