import { longestStopMs } from '../lifecycle/shutdown.ts';
import {
  isAnswering,
  probeAt,
  probeEveryMs,
  stoppedWhenAsked,
  waitedFor,
  type Probe,
  type RunningStatus,
  type Waiting,
} from './runtime-probe.ts';

export interface StartingLock {
  readonly take: () => boolean;
  readonly release: () => void;
}

export interface RuntimeProcesses {
  readonly signal: (pid: number, signal: 'SIGTERM' | 'SIGKILL') => boolean;
  readonly alive: (pid: number) => boolean;
}

export interface Sightings {
  readonly saw: (status: RunningStatus) => void;
  readonly last: () => RunningStatus | undefined;
}

export interface BackgroundStarting extends Waiting {
  readonly version: string;
  readonly startInBackground: () => void;
  readonly startingLock: StartingLock;
  readonly logFile: string;
  readonly notice: (line: string) => void;
  readonly restartUnderWay: () => boolean;
  readonly processes: RuntimeProcesses;
  readonly sightings: Sightings;
}

export interface Patience {
  readonly attempts: number;
}

export const startWaitMs = 60_000;

const startAttempts = Math.ceil(startWaitMs / probeEveryMs);

export const impatient: Patience = { attempts: 0 };

const briefWaitMs = 1000;

export const briefly: Patience = { attempts: Math.ceil(briefWaitMs / probeEveryMs) };

export const restartWaitMs = longestStopMs + startWaitMs;

export const throughARestart: Patience = { attempts: Math.ceil(restartWaitMs / probeEveryMs) };

const unansweredRetries = 2;

const stopAttempts = Math.ceil(longestStopMs / probeEveryMs);

const killAttempts = 20;

export function sightingsOfARelay(): Sightings {
  let last: RunningStatus | undefined;
  return {
    saw: (status) => {
      last = status;
    },
    last: () => last,
  };
}

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

function seen<Seen extends Probe | undefined>(probe: Seen, starting: BackgroundStarting): Seen {
  if (probe?.state === 'running') {
    starting.sightings.saw(probe.status);
  }
  return probe;
}

async function startedHere(port: number, starting: BackgroundStarting): Promise<string | undefined> {
  const took = starting.startingLock.take();
  if (took) {
    starting.startInBackground();
  }
  try {
    return seen(await waitedFor(port, starting, startAttempts, isAnswering), starting) === undefined
      ? `Auto Runtime did not start on port ${port}; its log is ${starting.logFile}`
      : undefined;
  } finally {
    if (took) {
      starting.startingLock.release();
    }
  }
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

async function gone(pid: number, starting: BackgroundStarting, attempts: number): Promise<boolean> {
  if (!starting.processes.alive(pid)) {
    return true;
  }
  if (attempts <= 0) {
    return false;
  }
  await starting.sleep(probeEveryMs);
  return gone(pid, starting, attempts - 1);
}

async function ended(pid: number, starting: BackgroundStarting): Promise<void> {
  starting.processes.signal(pid, 'SIGTERM');
  if (!(await gone(pid, starting, stopAttempts))) {
    starting.processes.signal(pid, 'SIGKILL');
    await gone(pid, starting, killAttempts);
  }
}

function unansweredBy(port: number, last: RunningStatus | undefined): string {
  return last?.started_by === 'terminal'
    ? `Auto Runtime on port ${port}, which runs in a terminal as process ${last.pid}, does not answer; stop it there, and this MCP entry starts another`
    : `The program on port ${port} does not answer; stop it, or set PORT to a free port, and this MCP entry starts Auto Runtime`;
}

async function unanswering(port: number, starting: BackgroundStarting): Promise<string | undefined> {
  if (seen(await waitedFor(port, starting, unansweredRetries, isAnswering), starting) !== undefined) {
    return undefined;
  }
  const last = starting.sightings.last();
  if (last?.started_by !== 'agent') {
    return unansweredBy(port, last);
  }
  starting.notice(
    `Auto Runtime ${last.version} on port ${port}, process ${last.pid}, did not answer, so it was stopped and another started`,
  );
  await ended(last.pid, starting);
  return startedHere(port, starting);
}

const refusals: Partial<Record<Probe['state'], (port: number) => string>> = {
  foreign: (port) => `Another program answers on port ${port}; set PORT to start Auto Runtime on a free port`,
  guarded: (port) =>
    `Auto Runtime on port ${port} asks for a credential, which this MCP entry does not send; stop it, and this entry starts one, or connect your agent to http://localhost:${port}/mcp over HTTP`,
};

export async function runningRuntime(
  port: number,
  starting: BackgroundStarting,
  patience: Patience,
): Promise<string | undefined> {
  const probe = seen(await probeAt(port, starting.fetch), starting);
  const outdated = outdatedOf(probe, starting.version);
  if (outdated !== undefined) {
    return replaced(port, outdated, starting);
  }
  const refused = refusals[probe.state];
  if (refused !== undefined) {
    return refused(port);
  }
  if (probe.state === 'unresponsive') {
    return unanswering(port, starting);
  }
  if (isAnswering(probe)) {
    return undefined;
  }
  const back = await waitedFor(port, starting, patienceFor(patience, starting).attempts, isAnswering);
  return seen(back, starting) === undefined ? startedHere(port, starting) : undefined;
}
