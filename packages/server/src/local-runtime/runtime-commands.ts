import { startedInWords } from '@on.auto/api';
import type { KeyCommandConsole } from '@on.auto/identity';
import { Effect } from 'effect';

import {
  askedTo,
  probeAt,
  stoppedWhenAsked,
  throughARestart,
  waitedFor,
  type Probe,
  type RunningStatus,
  type RuntimeFetch,
} from './runtime-probe.ts';

export type RuntimeCommand = 'status' | 'stop' | 'restart';

const runtimeCommands: ReadonlySet<string> = new Set<RuntimeCommand>(['status', 'stop', 'restart']);

export function isRuntimeCommand(name: string): name is RuntimeCommand {
  return runtimeCommands.has(name);
}

export interface RuntimeAsking {
  readonly fetch: RuntimeFetch;
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

function stopped(port: number, asking: RuntimeAsking): Effect.Effect<number> {
  return Effect.gen(function* () {
    if (!(yield* stoppedWhenAsked(port, asking.fetch))) {
      asking.console.error(`Auto Runtime on port ${port} did not stop`);
      return 1;
    }
    asking.console.log('Auto Runtime has stopped');
    return 0;
  });
}

function restarted(port: number, before: RunningStatus, asking: RuntimeAsking): Effect.Effect<number> {
  return Effect.gen(function* () {
    const done =
      (yield* askedTo('restart', port, asking.fetch)) &&
      (yield* waitedFor(port, asking.fetch, throughARestart.waitMs, startedAgainSince(before)));
    if (!done) {
      asking.console.error(`Auto Runtime on port ${port} did not come back after it was asked to restart`);
      return 1;
    }
    asking.console.log('Auto Runtime has restarted');
    return 0;
  });
}

function shown(status: RunningStatus, port: number, asking: RuntimeAsking): Effect.Effect<number> {
  return Effect.sync(() => {
    for (const line of linesOf(status, port)) {
      asking.console.log(line);
    }
    return 0;
  });
}

function answered(
  command: RuntimeCommand,
  port: number,
  status: RunningStatus,
  asking: RuntimeAsking,
): Effect.Effect<number> {
  if (command === 'stop') {
    return stopped(port, asking);
  }
  if (command === 'restart') {
    return restarted(port, status, asking);
  }
  return shown(status, port, asking);
}

const refusals: Readonly<Record<Exclude<Probe['state'], 'running'>, (port: number) => string>> = {
  down: (port) => `No Auto Runtime is running on port ${port}`,
  uncontrolled: (port) =>
    `The Auto Runtime on port ${port} cannot be controlled from here: only one the auto-runtime command started in local mode can`,
  foreign: (port) => `Another program answers on port ${port}, not Auto Runtime`,
};

export function runRuntimeCommand(command: RuntimeCommand, port: number, asking: RuntimeAsking): Effect.Effect<number> {
  return Effect.gen(function* () {
    const probe = yield* probeAt(port, asking.fetch);
    if (probe.state !== 'running') {
      asking.console.error(refusals[probe.state](port));
      return 1;
    }
    return yield* answered(command, port, probe.status, asking);
  });
}
