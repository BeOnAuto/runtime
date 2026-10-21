import { once } from 'node:events';
import type { Server } from 'node:http';
import { setTimeout } from 'node:timers/promises';

export interface ShutdownHooks {
  readonly stopWork: () => Promise<void>;
  readonly disposeRuntime: () => Promise<void>;
  readonly stopTelemetry: () => Promise<void>;
  readonly closeApi: () => Promise<void>;
}

export const shutdownTimeoutMs = 8000;

export const exitDeadlineMs = 1000;

const graceMs = 100;

export const longestStopMs = shutdownTimeoutMs + graceMs + exitDeadlineMs;

export async function shutDown(server: Server, hooks: ShutdownHooks, timeoutMs: number): Promise<void> {
  const closed = once(server, 'close');
  server.close();
  await Promise.all([Promise.race([closed, elapsed(timeoutMs)]), hooks.stopWork()]);
  await hooks.closeApi();
  await hooks.disposeRuntime();
  await hooks.stopTelemetry();
  await Promise.race([closed, elapsed(graceMs)]);
  server.closeAllConnections();
  await closed;
}

function elapsed(ms: number): Promise<void> {
  return setTimeout(ms, undefined, { ref: false });
}
