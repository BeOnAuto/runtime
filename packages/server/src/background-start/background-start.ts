import {
  probeAt,
  probeEveryMs,
  stoppedWhenAsked,
  waitedFor,
  type Probe,
  type RunningStatus,
  type Waiting,
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

export interface BackgroundStarting extends Waiting {
  readonly version: string;
  readonly startInBackground: () => StartedRuntime;
  readonly startingLock: StartingLock;
  readonly logFile: string;
  readonly notice: (line: string) => void;
  readonly restartUnderWay: () => boolean;
  readonly saw: (probe: Probe) => void;
  readonly remember: (runtime: StartedRuntime) => void;
  readonly pausing: () => boolean;
}

const startAttempts = Math.ceil(startWaitMs / probeEveryMs);

export const impatient: Patience = { attempts: 0 };

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

export async function lookedAt(port: number, starting: BackgroundStarting): Promise<Probe> {
  const probe = await probeAt(port, starting.fetch);
  starting.saw(probe);
  return probe;
}

export async function answersOn(port: number, starting: BackgroundStarting): Promise<boolean> {
  return isAnswering(await lookedAt(port, starting));
}

function seenAnswering(starting: BackgroundStarting, unless: () => boolean = () => false): (probe: Probe) => boolean {
  return (probe) => {
    starting.saw(probe);
    return isAnswering(probe) || unless();
  };
}

function startedBy(starting: BackgroundStarting): StartedRuntime | undefined {
  if (!starting.startingLock.take()) {
    return undefined;
  }
  const runtime = starting.startInBackground();
  starting.remember(runtime);
  return runtime;
}

function unansweredWords(port: number, logFile: string): string {
  return `Auto Runtime did not answer on port ${port} within ${startWaitMs / 1000} s of its start; its log is ${logFile}`;
}

async function wordsOnceItEnded(port: number, starting: BackgroundStarting): Promise<NotRunning> {
  return (await answersOn(port, starting))
    ? {
        words: `Another Auto Runtime took port ${port} first, so the one this connection started ended. Send the request again: it goes to the one on the port.`,
        anotherAnswers: true,
      }
    : { words: `Auto Runtime did not start on port ${port}; its log is ${starting.logFile}` };
}

async function startedHere(port: number, starting: BackgroundStarting): Promise<NotRunning | undefined> {
  if (starting.pausing()) {
    return { words: pausedWords(starting.logFile) };
  }
  const runtime = startedBy(starting);
  const ended = () => runtime?.endedAt() !== undefined;
  try {
    const answering = await waitedFor(port, starting, startAttempts, seenAnswering(starting, ended));
    if (ended()) {
      return await wordsOnceItEnded(port, starting);
    }
    return answering ? undefined : { words: unansweredWords(port, starting.logFile) };
  } finally {
    if (runtime !== undefined) {
      starting.startingLock.release();
    }
  }
}

export function anotherProgramOn(port: number): string {
  return `Another program answers on port ${port}; set PORT to start Auto Runtime on a free port`;
}

async function replaced(
  port: number,
  outdated: RunningStatus,
  starting: BackgroundStarting,
): Promise<NotRunning | undefined> {
  if (outdated.runs_in_flight > 0) {
    starting.notice(
      `Auto Runtime ${starting.version} waits for Auto Runtime ${outdated.version} on port ${port} to be idle before it replaces it, and relays to ${outdated.version} until then`,
    );
    return undefined;
  }
  return (await stoppedWhenAsked(port, starting))
    ? startedHere(port, starting)
    : {
        words: `Auto Runtime ${outdated.version} on port ${port} did not stop, so Auto Runtime ${starting.version} could not replace it`,
      };
}

export async function runningRuntime(
  port: number,
  starting: BackgroundStarting,
  patience: Patience,
): Promise<NotRunning | undefined> {
  const probe = await lookedAt(port, starting);
  const outdated = outdatedOf(probe, starting.version);
  if (outdated !== undefined) {
    return replaced(port, outdated, starting);
  }
  if (probe.state === 'foreign') {
    return { words: anotherProgramOn(port) };
  }
  const { attempts } = patienceFor(patience, starting);
  if (isAnswering(probe) || (await waitedFor(port, starting, attempts, seenAnswering(starting)))) {
    return undefined;
  }
  return startedHere(port, starting);
}
