import { startedInWords } from '@on.auto/api';
import type { KeyCommandConsole } from '@on.auto/identity';
import { Effect } from 'effect';

import { runLicenseActivation } from './license-command.ts';
import {
  askedTo,
  stoppedWhenAsked,
  throughARestart,
  waitedFor,
  whenRunning,
  type Probe,
  type RunningStatus,
  type RuntimeFetch,
} from './runtime-probe.ts';

export type RuntimeCommand = 'status' | 'stop' | 'restart';

const runtimeCommands: ReadonlySet<string> = new Set<RuntimeCommand>(['status', 'stop', 'restart']);

function isRuntimeCommand(name: string): name is RuntimeCommand {
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

export function runRuntimeCommand(command: RuntimeCommand, port: number, asking: RuntimeAsking): Effect.Effect<number> {
  return whenRunning(port, asking, (status) => answered(command, port, status, asking));
}

export function runtimeCommandOf(
  args: readonly string[],
): ((port: number, asking: RuntimeAsking) => Effect.Effect<number>) | undefined {
  const [name = '', verb, key = ''] = args;
  if (args.length === 1 && isRuntimeCommand(name)) {
    return (port, asking) => runRuntimeCommand(name, port, asking);
  }
  return args.length === 3 && name === 'license' && verb === 'activate'
    ? (port, asking) => runLicenseActivation(key, port, asking)
    : undefined;
}
