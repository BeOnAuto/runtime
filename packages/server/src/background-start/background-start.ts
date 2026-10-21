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

export interface StartingLock {
  readonly take: () => boolean;
  readonly release: () => void;
}

export interface BackgroundStarting extends Waiting {
  readonly version: string;
  readonly startInBackground: () => void;
  readonly startingLock: StartingLock;
  readonly logFile: string;
  readonly notice: (line: string) => void;
  readonly restartUnderWay: () => boolean;
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

export async function answersOn(port: number, starting: BackgroundStarting): Promise<boolean> {
  return isAnswering(await probeAt(port, starting.fetch));
}

async function startedHere(port: number, starting: BackgroundStarting): Promise<string | undefined> {
  const took = starting.startingLock.take();
  if (took) {
    starting.startInBackground();
  }
  try {
    return (await waitedFor(port, starting, startAttempts, isAnswering))
      ? undefined
      : `Auto Runtime did not start on port ${port}; its log is ${starting.logFile}`;
  } finally {
    if (took) {
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
): Promise<string | undefined> {
  if (outdated.runs_in_flight > 0) {
    starting.notice(
      `Auto Runtime ${starting.version} waits for Auto Runtime ${outdated.version} on port ${port} to be idle before it replaces it, and relays to ${outdated.version} until then`,
    );
    return undefined;
  }
  return (await stoppedWhenAsked(port, starting))
    ? startedHere(port, starting)
    : `Auto Runtime ${outdated.version} on port ${port} did not stop, so Auto Runtime ${starting.version} could not replace it`;
}

export async function runningRuntime(
  port: number,
  starting: BackgroundStarting,
  patience: Patience,
): Promise<string | undefined> {
  const probe = await probeAt(port, starting.fetch);
  const outdated = outdatedOf(probe, starting.version);
  if (outdated !== undefined) {
    return replaced(port, outdated, starting);
  }
  if (probe.state === 'foreign') {
    return anotherProgramOn(port);
  }
  if (isAnswering(probe) || (await waitedFor(port, starting, patienceFor(patience, starting).attempts, isAnswering))) {
    return undefined;
  }
  return startedHere(port, starting);
}
