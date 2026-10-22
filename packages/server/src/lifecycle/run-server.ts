import { setTimeout } from 'node:timers/promises';

import type { Environment } from '@on.auto/config';

import { ledgerOfAnotherVersionIn } from '../database/ledger-of-another-version.ts';
import { type RunningServer, type ServerOptions } from '../server-options/server-options.ts';
import { firstStartNotice } from '../usage-ping/usage-ping.ts';
import { startServer } from './lifecycle.ts';

export interface ServerProcess {
  readonly env: Environment;
  readonly stdout: { write(message: string): unknown };
  readonly stderr: { write(message: string, flushed: () => void): unknown };
  exit(code: number): void;
}

function sayThenExit(serverProcess: ServerProcess, line: string, exitCode: number): void {
  serverProcess.stderr.write(`${line}\n`, () => {
    serverProcess.exit(exitCode);
  });
}

async function stopThenExit(
  server: RunningServer,
  serverProcess: ServerProcess,
  { exitDeadlineMs }: { readonly exitDeadlineMs: number },
): Promise<void> {
  await server.stop();
  await setTimeout(exitDeadlineMs, undefined, { ref: false });
  sayThenExit(
    serverProcess,
    `Auto Runtime was still running ${exitDeadlineMs} ms after it stopped, so it exits now`,
    0,
  );
}

async function exitWhenInsisted(stopInsisted: Promise<void>, serverProcess: ServerProcess): Promise<void> {
  await stopInsisted;
  sayThenExit(serverProcess, 'Auto Runtime was told to stop again, so it exits now without finishing its shutdown', 1);
}

export async function runServer<R>(
  serverProcess: ServerProcess,
  options: ServerOptions<R>,
  stopRequested: Promise<void>,
  stopInsisted: Promise<void>,
): Promise<RunningServer> {
  void exitWhenInsisted(stopInsisted, serverProcess);
  const server = await startServer(serverProcess.env, options);
  void stopRequested.then(() => stopThenExit(server, serverProcess, options));
  serverProcess.stdout.write(`Auto Runtime listening on port ${server.port}\n`);
  if (server.install?.isNew === true) {
    serverProcess.stdout.write(`${firstStartNotice}\n`);
  }
  return server;
}

function startupFailureLineOf(failure: unknown): string {
  return `Auto Runtime could not start: ${String(failure).replaceAll(/\s*\n\s*/gu, ' ')}`;
}

function ledgerRefusalLineOf(failure: unknown): string | undefined {
  const refusal = ledgerOfAnotherVersionIn(failure);
  return refusal === undefined ? undefined : startupFailureLineOf(refusal.message);
}

export function exitOnStartupFailure(
  serverProcess: ServerProcess,
  noticeOf: (failure: unknown) => string | undefined = ledgerRefusalLineOf,
): (failure: unknown) => void {
  return (failure) => {
    sayThenExit(serverProcess, noticeOf(failure) ?? startupFailureLineOf(failure), 1);
  };
}
