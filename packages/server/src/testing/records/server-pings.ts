import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Environment } from '@on.auto/config';
import { onTestFinished } from 'vitest';

import { usagePingOf, type PingFetch } from '../../usage-ping/usage-ping.ts';
import { defaultServerOptions } from '../entries/serving-options.ts';

export interface Pings {
  readonly fetch: PingFetch;
  readonly urls: readonly string[];
  readonly signals: readonly AbortSignal[];
}

export function folderOfTheTest(): string {
  const folder = mkdtempSync(join(tmpdir(), 'auto-runtime-usage-ping-server-'));
  onTestFinished(() => {
    rmSync(folder, { recursive: true, force: true });
  });
  return folder;
}

function recorded(answer: (signal: AbortSignal) => Promise<Response>): Pings {
  const urls: string[] = [];
  const signals: AbortSignal[] = [];
  return {
    urls,
    signals,
    fetch: (url, { signal }) => {
      urls.push(url);
      signals.push(signal);
      return answer(signal);
    },
  };
}

export function answered(): Pings {
  return recorded(() => Promise.resolve(new Response('')));
}

export function unanswered(): Pings {
  return recorded(
    (signal) =>
      new Promise((_answer, refuse) => {
        signal.addEventListener('abort', () => {
          refuse(new Error('the ping was given up', { cause: signal.reason }));
        });
      }),
  );
}

export function optionsPingingThrough(pings: Pings, runtimeHome: string) {
  return {
    ...defaultServerOptions,
    usagePing: usagePingOf({ fetch: pings.fetch, runtimeHome, running: process }),
  };
}

export function settingsIn(folder: string, environment: Environment = {}): Environment {
  return { HOST: '127.0.0.1', PORT: '0', LEDGER_FILE: join(folder, 'ledger.db'), ...environment };
}
