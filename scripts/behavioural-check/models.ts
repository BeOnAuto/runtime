import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Schema } from 'effect';

export const ModelSchema = Schema.Struct({
  name: Schema.String,
  command: Schema.NonEmptyArray(Schema.String),
  prompt: Schema.Literals(['stdin', 'argument']),
  version: Schema.NonEmptyArray(Schema.String),
});

export type Model = typeof ModelSchema.Type;

export const AnswerSchema = Schema.Struct({
  exit: Schema.Union([Schema.Number, Schema.Literals(['timeout', 'stopped', 'not started'])]),
  stdout: Schema.String,
  stderr: Schema.String,
  seconds: Schema.Number,
});

export type Answer = typeof AnswerSchema.Type;

export type Ask = (model: Model, prompt: string) => Promise<Answer>;

const longestAnswerMs = 900_000;

const keptOfTheErrors = 4000;

function argumentsOf({ command, prompt: given }: Model, prompt: string): readonly string[] {
  return given === 'argument' ? [...command.slice(1), prompt] : command.slice(1);
}

/** The bound of an answer: `after(ms, expire)` calls `expire` once `ms` passed, and answers what cancels it. */
export interface Bound {
  readonly after: (ms: number, expire: () => void) => () => void;
}

const realBound: Bound = {
  after: (ms, expire) => {
    const timer = setTimeout(expire, ms);
    return () => {
      clearTimeout(timer);
    };
  },
};

function endedAs(code: number | null, timedOut: boolean): Answer['exit'] {
  if (code !== null) {
    return code;
  }
  return timedOut ? 'timeout' : 'stopped';
}

export function askingThroughItsCommand(longestMs = longestAnswerMs, bound: Bound = realBound): Ask {
  return (model, prompt) =>
    new Promise((answered) => {
      const started = Date.now();
      const folder = mkdtempSync(join(tmpdir(), 'behavioural-check-'));
      const child = spawn(model.command[0], argumentsOf(model, prompt), { cwd: folder });
      const timing = { out: false };
      const cancel = bound.after(longestMs, () => {
        timing.out = true;
        child.kill('SIGTERM');
      });
      let stdout = '';
      let stderr = '';
      const seconds = () => Math.round((Date.now() - started) / 1000);
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
        stderr += chunk;
      });
      child.on('error', ({ message }: Readonly<Error>) => {
        cancel();
        rmSync(folder, { recursive: true, force: true });
        answered({ exit: 'not started', stdout, stderr: message, seconds: seconds() });
      });
      child.on('close', (code) => {
        cancel();
        rmSync(folder, { recursive: true, force: true });
        answered({
          exit: endedAs(code, timing.out),
          stdout,
          stderr: stderr.slice(-keptOfTheErrors),
          seconds: seconds(),
        });
      });
      child.stdin
        .on('error', ({ message }: Readonly<Error>) => {
          stderr += message;
        })
        .end(model.prompt === 'stdin' ? prompt : '');
    });
}

export function versionOf({ version }: Model): string {
  return execFileSync(version[0], version.slice(1), { encoding: 'utf8' }).split('\n').at(0) ?? '';
}
