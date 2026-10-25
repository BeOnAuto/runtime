import type { RecordedContent } from '@on.auto/operations';
import { Effect } from 'effect';
import { afterEach } from 'vitest';

import type { ToolAccess } from '../access/tool-access.ts';
import type { Timing } from '../bounds/call-bounds.ts';
import type { CalledOnce } from '../one-call/called-once.ts';
import type { OneCall, RunCall } from '../one-call/one-call.ts';
import { patientTiming } from './index.ts';
import { reportingAccess } from './reporting-access.ts';
import { serveFakeMcp, type FakeMcpOptions, type FakeMcpServer } from './served-fakes.ts';

export const oneCallKey = 'graph-api-key-4f1d9a7c2b';

export const callingRunId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

export const deliveryId = '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

export function closedAfter(close: () => Promise<void>): void {
  closing.push(close);
}

export async function oneCallServer(options: FakeMcpOptions = {}): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({ ...options, bearer: oneCallKey });
  closedAfter(fake.close);
  return fake;
}

const allowedTools = ['echo', 'denied', 'sleep', 'large', 'search', 'gone', 'profile', 'promised'];

export function oneCallAccess(
  url: string,
  changes: Readonly<Record<string, unknown>> = {},
  timing: Partial<Timing> = {},
): ToolAccess & { readonly content: RecordedContent } {
  const { access, content } = reportingAccess(
    {
      graph: {
        url,
        headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' },
        org: 'acme',
        allowed: allowedTools,
        ...changes,
      },
    },
    { environment: { GRAPH_API_KEY: oneCallKey }, timing: { ...patientTiming, ...timing } },
  );
  closedAfter(access.close);
  return { ...access, content };
}

export const echoCall: OneCall = {
  org: 'acme',
  playbook: 'alpha',
  reference: { server: 'graph', tool: 'echo' },
  input: { channel: '#approvals', text: 'Please approve' },
  meta: { 'auto.on/run_id': callingRunId, 'auto.on/delivery_id': deliveryId },
};

export function calledOnce(
  access: Pick<ToolAccess, 'callOnce'>,
  changes: Readonly<Partial<OneCall>> = {},
  runCall?: RunCall,
): Promise<CalledOnce> {
  return Effect.runPromise(access.callOnce({ ...echoCall, ...changes }, runCall));
}

export function failedWith(outcome: string, detail: unknown, retryAfterMs: number | null = null) {
  return { kind: 'answered', outcome, detail, retryAfterMs };
}

export function unopenedWith(refused: string, because: string, detail: string) {
  return { kind: 'unopened', refused, because, detail };
}
