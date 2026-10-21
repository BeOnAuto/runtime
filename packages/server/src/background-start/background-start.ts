import { Effect, type Scope } from 'effect';

import {
  probeAt,
  stoppedWhenAsked,
  waitedFor,
  type Probe,
  type RunningStatus,
  type RuntimeFetch,
} from '../local-runtime/runtime-probe.ts';
import { startWaitMs, throughARestart, type Patience } from '../local-runtime/runtime-restarts.ts';
import { pausedWords, type StartedRuntime } from './started-runtimes.ts';

export interface NotRunning {
  readonly words: string;
  readonly anotherAnswers?: true;
}

export interface StartingLock {
  readonly take: () => boolean;
  readonly release: () => void;
}

export interface BackgroundStarting {
  readonly version: string;
  readonly fetch: RuntimeFetch;
  readonly startInBackground: () => StartedRuntime;
  readonly startingLock: StartingLock;
  readonly logFile: string;
  readonly notice: (line: string) => void;
  readonly restartUnderWay: () => boolean;
  readonly saw: (probe: Probe) => void;
  readonly remember: (runtime: StartedRuntime) => void;
  readonly pausing: () => boolean;
}

export const impatient: Patience = { waitMs: 0 };

function isNewer(version: string, than: string): boolean {
  return version.localeCompare(than, 'en', { numeric: true }) > 0;
}

function outdatedOf(probe: Probe, version: string): RunningStatus | undefined {
  const outdated =
    probe.state === 'running' && probe.status.started_by === 'agent' && isNewer(version, probe.status.version);
  return outdated ? probe.status : undefined;
}

function patienceFor(patience: Patience, starting: BackgroundStarting): Patience {
  return starting.restartUnderWay() ? throughARestart : patience;
}

function isAnswering(probe: Probe): boolean {
  return probe.state === 'running' || probe.state === 'uncontrolled';
}

export function lookedAt(port: number, starting: BackgroundStarting): Effect.Effect<Probe> {
  return probeAt(port, starting.fetch).pipe(
    Effect.tap((probe) =>
      Effect.sync(() => {
        starting.saw(probe);
      }),
    ),
  );
}

export function answersOn(port: number, starting: BackgroundStarting): Effect.Effect<boolean> {
  return lookedAt(port, starting).pipe(Effect.map(isAnswering));
}

function seenAnswering(starting: BackgroundStarting, unless: () => boolean = () => false): (probe: Probe) => boolean {
  return (probe) => {
    starting.saw(probe);
    return isAnswering(probe) || unless();
  };
}

function startingLockTakenBy({ startingLock }: BackgroundStarting): Effect.Effect<boolean, never, Scope.Scope> {
  return Effect.acquireRelease(
    Effect.sync(() => startingLock.take()),
    (taken) =>
      taken
        ? Effect.sync(() => {
            startingLock.release();
          })
        : Effect.void,
  );
}

function startedInTheBackground(starting: BackgroundStarting): StartedRuntime {
  const runtime = starting.startInBackground();
  starting.remember(runtime);
  return runtime;
}

function unansweredWords(port: number, logFile: string): string {
  return `Auto Runtime did not answer on port ${port} within ${startWaitMs / 1000} s of its start; its log is ${logFile}`;
}

function wordsOnceItEnded(port: number, starting: BackgroundStarting): Effect.Effect<NotRunning> {
  return answersOn(port, starting).pipe(
    Effect.map((answers): NotRunning =>
      answers
        ? {
            words: `Another Auto Runtime took port ${port} first, so the one this connection started ended. Send the request again: it goes to the one on the port.`,
            anotherAnswers: true,
          }
        : { words: `Auto Runtime did not start on port ${port}; its log is ${starting.logFile}` },
    ),
  );
}

function startedHere(port: number, starting: BackgroundStarting): Effect.Effect<NotRunning | undefined> {
  return Effect.gen(function* () {
    if (starting.pausing()) {
      return { words: pausedWords(starting.logFile) };
    }
    const runtime = (yield* startingLockTakenBy(starting)) ? startedInTheBackground(starting) : undefined;
    const ended = () => runtime?.endedAt() !== undefined;
    const answering = yield* waitedFor(port, starting.fetch, startWaitMs, seenAnswering(starting, ended));
    if (ended()) {
      return yield* wordsOnceItEnded(port, starting);
    }
    return answering ? undefined : { words: unansweredWords(port, starting.logFile) };
  }).pipe(Effect.scoped);
}

export function anotherProgramOn(port: number): string {
  return `Another program answers on port ${port}; set PORT to start Auto Runtime on a free port`;
}

function replaced(
  port: number,
  outdated: RunningStatus,
  starting: BackgroundStarting,
): Effect.Effect<NotRunning | undefined> {
  if (outdated.runs_in_flight > 0) {
    return Effect.sync((): undefined => {
      starting.notice(
        `Auto Runtime ${starting.version} waits for Auto Runtime ${outdated.version} on port ${port} to be idle before it replaces it, and relays to ${outdated.version} until then`,
      );
    });
  }
  return Effect.gen(function* () {
    return (yield* stoppedWhenAsked(port, starting.fetch))
      ? yield* startedHere(port, starting)
      : {
          words: `Auto Runtime ${outdated.version} on port ${port} did not stop, so Auto Runtime ${starting.version} could not replace it`,
        };
  });
}

function answeredWithin(patience: Patience, port: number, starting: BackgroundStarting): Effect.Effect<boolean> {
  return waitedFor(port, starting.fetch, patienceFor(patience, starting).waitMs, seenAnswering(starting));
}

export function runningRuntime(
  port: number,
  starting: BackgroundStarting,
  patience: Patience,
): Effect.Effect<NotRunning | undefined> {
  return Effect.gen(function* () {
    const probe = yield* lookedAt(port, starting);
    const outdated = outdatedOf(probe, starting.version);
    if (outdated !== undefined) {
      return yield* replaced(port, outdated, starting);
    }
    if (probe.state === 'foreign') {
      return { words: anotherProgramOn(port) };
    }
    const answering = isAnswering(probe) || (yield* answeredWithin(patience, port, starting));
    return answering ? undefined : yield* startedHere(port, starting);
  });
}
