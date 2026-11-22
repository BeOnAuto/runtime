import { once } from 'node:events';
import type { Server } from 'node:http';
import { setTimeout } from 'node:timers/promises';

/** Answers once the given milliseconds passed; a test hands in its own, so no wait runs on the real clock. */
export type Elapsed = (milliseconds: number) => Promise<void>;

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

export async function shutDown(
  server: Server,
  hooks: ShutdownHooks,
  timeoutMs: number,
  elapsedAfter: Elapsed = elapsed,
): Promise<void> {
  const closed = once(server, 'close');
  server.close();
  await Promise.all([Promise.race([closed, elapsedAfter(timeoutMs)]), hooks.stopWork()]);
  await hooks.closeApi();
  await hooks.disposeRuntime();
  await hooks.stopTelemetry();
  await Promise.race([closed, elapsedAfter(graceMs)]);
  server.closeAllConnections();
  await closed;
}

/** The order `shutDown` keeps, for a server that answers in the process and has no listener to close. */
export async function shutDownInProcess(hooks: ShutdownHooks): Promise<void> {
  await hooks.stopWork();
  await hooks.closeApi();
  await hooks.disposeRuntime();
  await hooks.stopTelemetry();
}

function elapsed(ms: number): Promise<void> {
  return setTimeout(ms, undefined, { ref: false });
}
