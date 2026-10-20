import { startedInWords } from '@on.auto/api';
import type { KeyCommandConsole } from '@on.auto/identity';

import { throughARestart } from './background-start.ts';
import {
  askedTo,
  probeAt,
  stoppedWhenAsked,
  waitedFor,
  type Probe,
  type RunningStatus,
  type Waiting,
} from './runtime-probe.ts';

export type RuntimeCommand = 'status' | 'stop' | 'restart';

const runtimeCommands: ReadonlySet<string> = new Set<RuntimeCommand>(['status', 'stop', 'restart']);

export function isRuntimeCommand(name: string): name is RuntimeCommand {
  return runtimeCommands.has(name);
}

export interface RuntimeAsking extends Waiting {
  readonly console: KeyCommandConsole;
}

function linesOf(status: RunningStatus, port: number): readonly string[] {
  return [
    `Auto Runtime ${status.version} is running at http://localhost:${port}`,
    `  Process    ${status.pid}`,
    `  Started    ${startedInWords(new Date(status.started_at), status.started_by)}`,
    `  Directory  ${status.directory}`,
    ...(status.log_file === undefined ? [] : [`  Log        ${status.log_file}`]),
  ];
}

function startedAgainSince(before: RunningStatus): (probe: Probe) => boolean {
  return (probe) => probe.state === 'running' && probe.status.started_at !== before.started_at;
}

async function stopped(port: number, asking: RuntimeAsking): Promise<number> {
  if (!(await stoppedWhenAsked(port, asking))) {
    asking.console.error(`Auto Runtime on port ${port} did not stop`);
    return 1;
  }
  asking.console.log('Auto Runtime has stopped');
  return 0;
}

async function restarted(port: number, before: RunningStatus, asking: RuntimeAsking): Promise<number> {
  const done =
    (await askedTo('restart', port, asking.fetch)) &&
    (await waitedFor(port, asking, throughARestart.attempts, startedAgainSince(before))) !== undefined;
  if (!done) {
    asking.console.error(`Auto Runtime on port ${port} did not come back after it was asked to restart`);
    return 1;
  }
  asking.console.log('Auto Runtime has restarted');
  return 0;
}

function answered(
  command: RuntimeCommand,
  port: number,
  status: RunningStatus,
  asking: RuntimeAsking,
): Promise<number> {
  if (command === 'stop') {
    return stopped(port, asking);
  }
  if (command === 'restart') {
    return restarted(port, status, asking);
  }
  for (const line of linesOf(status, port)) {
    asking.console.log(line);
  }
  return Promise.resolve(0);
}

const refusals: Readonly<Record<Exclude<Probe['state'], 'running'>, (port: number) => string>> = {
  down: (port) => `No Auto Runtime is running on port ${port}`,
  uncontrolled: (port) =>
    `The Auto Runtime on port ${port} cannot be controlled from here: only one the auto-runtime command started in local mode can`,
  guarded: (port) =>
    `The Auto Runtime on port ${port} asks for a credential, so it cannot be controlled from here: only one the auto-runtime command started in local mode can`,
  unresponsive: (port) => `The Auto Runtime on port ${port} does not answer`,
  foreign: (port) => `Another program answers on port ${port}, not Auto Runtime`,
};

export async function runRuntimeCommand(command: RuntimeCommand, port: number, asking: RuntimeAsking): Promise<number> {
  const probe = await probeAt(port, asking.fetch);
  if (probe.state !== 'running') {
    asking.console.error(refusals[probe.state](port));
    return 1;
  }
  return answered(command, port, probe.status, asking);
}
