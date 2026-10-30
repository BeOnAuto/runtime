import { isLocalHost } from '../middleware/validate-host.ts';
import { problemOf, problemResponse } from '../problem/problem.ts';

export type StartedBy = 'terminal' | 'agent';

export interface RuntimeStatus {
  readonly version: string;
  readonly pid: number;
  readonly instance: string;
  readonly startedAt: Date;
  readonly directory: string;
  readonly startedBy: StartedBy;
  readonly logFile: string | undefined;
  readonly runsInFlight: number;
}

export interface RuntimeControl {
  readonly status: () => RuntimeStatus;
  readonly stop: () => void;
  readonly restart: () => void;
}

export type RuntimeAction = 'stop' | 'restart';

export const runtimePath = '/runtime';

export const runtimeActionPaths: Readonly<Record<RuntimeAction, string>> = {
  stop: `${runtimePath}/stop`,
  restart: `${runtimePath}/restart`,
};

const notFromThisComputer = problemOf('forbidden', 'Only this computer can control Auto Runtime');

const notFromItsPage = problemOf('origin_not_allowed', 'Only the page of this server can control Auto Runtime');

interface Asker {
  readonly host: string;
  readonly origin: string | undefined;
  readonly fetchSite: string | undefined;
}

function isFromItsPage({ host, origin, fetchSite }: Asker): boolean {
  if (origin === 'null') {
    return fetchSite === 'same-origin';
  }
  return origin === undefined || origin.toLowerCase() === `http://${host.toLowerCase()}`;
}

export function refusalOf(asker: Asker): Response | undefined {
  if (!isLocalHost(asker.host)) {
    return problemResponse(notFromThisComputer);
  }
  return isFromItsPage(asker) ? undefined : problemResponse(notFromItsPage);
}

const startedByWords: Readonly<Record<StartedBy, string>> = {
  terminal: 'in a terminal',
  agent: 'by your agent',
};

export function startedInWords(startedAt: Date, startedBy: StartedBy): string {
  return `${startedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC, ${startedByWords[startedBy]}`;
}

export function statusDocumentOf(status: RuntimeStatus): Readonly<Record<string, string | number>> {
  return {
    version: status.version,
    pid: status.pid,
    instance: status.instance,
    started_at: status.startedAt.toISOString(),
    started_by: status.startedBy,
    directory: status.directory,
    ...(status.logFile === undefined ? {} : { log_file: status.logFile }),
    runs_in_flight: status.runsInFlight,
  };
}

export function act(control: RuntimeControl, action: RuntimeAction): void {
  if (action === 'stop') {
    control.stop();
  } else {
    control.restart();
  }
}
