import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

import { onTestFinished } from 'vitest';

import type { ChildCommand, RunningChild, Written } from '../../development/children.ts';
import type { DevelopmentSetup } from '../../development/development-run.ts';
import { runDevelopment, type DevelopmentProcess } from '../../development/development.ts';
import type { SourceChanges } from '../../development/source-changes.ts';
import type { DevelopmentStopSignal } from '../../development/stop-signals.ts';
import { temporaryLedger } from '../records/temporary-ledger.ts';
import { startedInProcess } from './in-process-starts.ts';

/*
 * pnpm dev without its processes: its runner over fakes of the children it starts, the changes it is told and its
 * stop signals, and the server it runs, started in this process with the settings of dev.env.
 */

interface FakeChild extends RunningChild {
  readonly command: ChildCommand;
  readonly says: (text: string) => void;
  readonly ends: (reason: string) => void;
  readonly signalled: () => readonly NodeJS.Signals[];
}

function isWritten(output: ChildCommand['stdout']): output is Written {
  return typeof output === 'function';
}

/** A child that ends when signalled, or, holding on, only once the test ends it. */
function fakeChildOf(command: ChildCommand, pid: number, holdsOn: boolean): FakeChild {
  const { promise: ended, resolve } = Promise.withResolvers<string>();
  const signalled: NodeJS.Signals[] = [];
  const signal = (name: NodeJS.Signals) => {
    signalled.push(name);
    return true;
  };
  return {
    command,
    pid,
    ended,
    signal,
    stop: (name) => {
      signal(name);
      if (!holdsOn) {
        resolve(`signal ${name}`);
      }
      return ended;
    },
    says: (text) => {
      [command.stdout]
        .filter((output) => isWritten(output))
        .forEach((write) => {
          write(text);
        });
    },
    ends: resolve,
    signalled: () => signalled,
  };
}

/** Tells the waiting test each time something counted grows past what it waits for, never on time. */
function counted() {
  const state = { count: 0, waits: new Set<() => void>() };
  const past = (count: number): Promise<void> => {
    if (state.count > count) {
      return Promise.resolve();
    }
    const { promise, resolve } = Promise.withResolvers<void>();
    state.waits.add(resolve);
    return promise.then(() => past(count));
  };
  return {
    count: () => state.count,
    grew: () => {
      state.count += 1;
      const woken = [...state.waits];
      state.waits.clear();
      woken.forEach((wake) => {
        wake();
      });
    },
    past,
  };
}

/** The changes a watch of the files tells, as one change at a time that the test makes. */
function toldChanges() {
  const asks = counted();
  const state = { pending: Promise.withResolvers<string>() };
  const changes: SourceChanges = {
    next: () => {
      asks.grew();
      return state.pending.promise;
    },
    close: () => {},
  };
  return {
    changes,
    asks,
    saved: async (file: string) => {
      await asks.past(0);
      const told = state.pending;
      state.pending = Promise.withResolvers<string>();
      told.resolve(file);
    },
  };
}

function hostOf(listeners: Map<DevelopmentStopSignal, () => void>, env: DevelopmentProcess['env']): DevelopmentProcess {
  return {
    env,
    execPath: '/the/node',
    pid: 42,
    stdout: { write: () => true },
    on: (signal, listener) => {
      listeners.set(signal, listener);
    },
  };
}

interface Marks {
  readonly left: (readonly [number, number])[];
  readonly cleared: number[];
}

/**
 * The runner of pnpm dev with fakes at its edges: the children it starts, the changes it is told of, its restart mark
 * and its stop signals. Each step of a test waits on what the runner did.
 */
export interface RunnerParts extends Partial<Pick<DevelopmentSetup, 'envFiles' | 'serverEntry' | 'configFile'>> {
  readonly holdsOn?: boolean;
  /** The variables of the shell the runner runs in. */
  readonly shell?: DevelopmentProcess['env'];
}

export function aRunner({ holdsOn = false, shell = {}, ...files }: RunnerParts = {}) {
  const children: FakeChild[] = [];
  const born: PromiseWithResolvers<FakeChild>[] = [];
  const bornAs = (index: number): PromiseWithResolvers<FakeChild> => (born[index] ??= Promise.withResolvers());
  const told = toldChanges();
  const listeners = new Map<DevelopmentStopSignal, () => void>();
  const marks: Marks = { left: [], cleared: [] };
  const setup: DevelopmentSetup = {
    envFiles: [],
    sourceDirectories: [],
    serverEntry: '/the/server/main.ts',
    configFile: '/no/such/auto-runtime.yaml',
    ...files,
    startChild: (command) => {
      const child = fakeChildOf(command, 100 + children.length, holdsOn);
      bornAs(children.length).resolve(child);
      children.push(child);
      return child;
    },
    restartMark: {
      leave: (pid, port) => marks.left.push([pid, port]) > 0,
      clear: (pid) => {
        marks.cleared.push(pid);
      },
    },
    watchSourcesOf: () => told.changes,
  };
  return {
    exitCode: runDevelopment(hostOf(listeners, shell), setup),
    marks,
    /** The child the runner started as its `index`th, once it has. */
    child: (index: number): Promise<FakeChild> => bornAs(index).promise,
    started: () => children.length,
    saved: told.saved,
    asks: told.asks,
    stopped: (signal: DevelopmentStopSignal) => {
      listeners.get(signal)?.();
    },
  };
}

const devEnv = new URL('../../../dev.env', import.meta.url);

/**
 * The server as pnpm dev runs it, with the settings of dev.env and those given, started in this process on a ledger of
 * the test's own and stopped with the test. That pnpm dev hands the server those settings is proven on `aRunner`, and
 * on its process once, in env-files.test.ts.
 */
export async function servedAsPnpmDevServesIt(
  settings: Readonly<Record<string, string>> = {},
): ReturnType<typeof startedInProcess> {
  const ledger = temporaryLedger();
  const server = await startedInProcess({
    ...parseEnv(readFileSync(devEnv, 'utf8')),
    PORT: '0',
    LEDGER_FILE: ledger.fileName,
    LOG_FORMAT: 'json',
    ...settings,
  });
  onTestFinished(async () => {
    await server.stop();
    ledger.remove();
  });
  return server;
}
