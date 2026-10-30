import { Schema } from 'effect';

import { compositionRoot } from '../src/composition/composition-root.ts';
import { startServer } from '../src/lifecycle/lifecycle.ts';
import type { RunningServer } from '../src/server-options/server-options.ts';

export const playbook = '/v1/orgs/local/playbooks/measure';

export interface MeasuredServer {
  readonly call: (method: string, path: string, body?: unknown) => Promise<unknown>;
  readonly stop: () => Promise<void>;
}

const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

async function called(server: RunningServer, method: string, path: string, body: unknown): Promise<unknown> {
  const response = await fetch(`http://127.0.0.1:${server.port}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return decodeJson(await response.text());
}

export async function measuredServer(ledger: Readonly<Record<string, string>>): Promise<MeasuredServer> {
  const server = await startServer(
    { HOST: '127.0.0.1', PORT: '0', INTERACTION_OPEN_REQUESTS: '20000', ...ledger },
    compositionRoot,
  );
  return {
    call: (method, path, body) => called(server, method, path, body),
    stop: () => server.stop(),
  };
}

export async function inTurns(count: number, atOnce: number, work: (index: number) => Promise<void>): Promise<void> {
  const next = { index: 0 };
  const worker = async (): Promise<void> => {
    const { index } = next;
    if (index < count) {
      next.index += 1;
      await work(index);
      await worker();
    }
  };
  await Promise.all(Array.from({ length: atOnce }, worker));
}

export function percentile(sorted: readonly number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))] ?? Number.NaN;
}
