import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Option, Schema } from 'effect';

import { longestStopMs } from '../lifecycle/shutdown.ts';
import { runtimeHomeIn } from './local-control.ts';

export interface Patience {
  readonly waitMs: number;
}

export const startWaitMs = 60_000;

export const restartWaitMs = longestStopMs + startWaitMs;

export const throughARestart: Patience = { waitMs: restartWaitMs };

export interface RestartMark {
  readonly leave: (pid: number, port: number) => boolean;
  readonly clear: (pid: number) => void;
  readonly isUnderWay: (port: number) => boolean;
}

const restartMarkOf = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ pid: Schema.Number, at: Schema.Number, port: Schema.Number })),
);

function textIn(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function leftIn(file: string, text: string): boolean {
  try {
    writeFileSync(file, text);
    return true;
  } catch {
    return false;
  }
}

export function restartMarkIn(home: string, now: () => number = Date.now): RestartMark {
  const file = join(runtimeHomeIn(home), 'restart-mark.json');
  const markLeft = () => Option.getOrUndefined(restartMarkOf(textIn(file)));
  return {
    leave: (pid, port) => {
      mkdirSync(runtimeHomeIn(home), { recursive: true });
      return leftIn(file, JSON.stringify({ pid, at: now(), port }));
    },
    clear: (pid) => {
      if (markLeft()?.pid === pid) {
        rmSync(file, { force: true });
      }
    },
    isUnderWay: (port) => {
      const mark = markLeft();
      return mark?.port === port && isRunning(mark.pid) && now() - mark.at <= restartWaitMs;
    },
  };
}
