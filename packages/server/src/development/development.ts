import { fileURLToPath } from 'node:url';

import type { Environment } from '@on.auto/config';

import type { ChildCommand, RunningChild, Written } from './children.ts';
import type { DevelopmentRun, DevelopmentSetup } from './development-run.ts';
import { readyNotice } from './ready-notice.ts';
import { runnerLogFor } from './runner-log.ts';
import { presentEnvFiles, rootConfigFile, settingsOf, watchedConfigFile } from './settings-files.ts';
import { sourcesOf, watchSources, type SourceChanges } from './source-changes.ts';
import { stopRequestedThrough, type DevelopmentStopSignal } from './stop-signals.ts';

export interface DevelopmentProcess {
  readonly env: Environment;
  readonly execPath: string;
  readonly stdout: { write(text: string): unknown };
  on(signal: DevelopmentStopSignal, listener: () => void): unknown;
}

type Event = 'stop' | { readonly changed: string } | { readonly server: string };

const never = Promise.withResolvers<string>().promise;

interface Serving {
  readonly server: RunningChild | undefined;
  readonly changes: SourceChanges;
  readonly output: Written;
}

const stopWithRunner = fileURLToPath(new URL('stop-with-runner.ts', import.meta.url));

const usagePingOff = { USAGE_PING: 'false' };

function serverCommand(run: DevelopmentRun, output: Written): ChildCommand {
  return {
    command: run.execPath,
    args: [
      ...presentEnvFiles(run.setup).map((envFile) => `--env-file=${envFile}`),
      stopWithRunner,
      run.setup.serverEntry,
    ],
    environment: { ...run.environment, ...rootConfigFile(run), ...usagePingOff },
    stdin: 'pipe',
    stdout: output,
    stderr: 'inherit',
  };
}

async function stopped(signal: NodeJS.Signals, children: readonly (RunningChild | undefined)[]): Promise<void> {
  const running = children.filter((child): child is RunningChild => child !== undefined);
  await Promise.all(running.map((child) => child.stop(signal)));
}

async function restarted(run: DevelopmentRun, serving: Serving, file: string): Promise<number> {
  run.log.info(`${file} changed, so the server restarts`);
  await stopped('SIGTERM', [serving.server]);
  const stopping = await Promise.race([run.stopRequested, Promise.resolve('restart')]);
  if (stopping === 'stop') {
    return 0;
  }
  return served(run, { ...serving, server: run.start(serverCommand(run, serving.output)) });
}

async function served(run: DevelopmentRun, serving: Serving): Promise<number> {
  const { server, changes } = serving;
  const event = await Promise.race<Event>([
    run.stopRequested,
    changes.next().then((changed) => ({ changed })),
    (server?.ended ?? never).then((reason) => ({ server: reason })),
  ]);
  if (event === 'stop') {
    await stopped('SIGTERM', [server]);
    return 0;
  }
  if ('changed' in event) {
    return restarted(run, serving, event.changed);
  }
  run.log.warn(`The server stopped (${event.server}); it starts again when a file changes`);
  await stopped('SIGTERM', [server]);
  return served(run, { ...serving, server: undefined });
}

function announcingReadiness(host: DevelopmentProcess, run: DevelopmentRun): Written {
  const { promise: listening, resolve: heard } = Promise.withResolvers<string>();
  void (async () => {
    const line = await listening;
    run.log.info(readyNotice(Number(/port (\d+)/u.exec(line)?.[1]), { ...run.settings, ...rootConfigFile(run) }));
  })();
  return (text) => {
    host.stdout.write(text);
    heard(text);
  };
}

export async function runDevelopment(host: DevelopmentProcess, setup: DevelopmentSetup): Promise<number> {
  const stopRequested = stopRequestedThrough(host).then((): 'stop' => 'stop');
  const settings = settingsOf(host.env, setup);
  const run: DevelopmentRun = {
    setup,
    execPath: host.execPath,
    environment: host.env,
    settings,
    log: runnerLogFor(settings),
    stopRequested,
    start: setup.startChild,
  };
  const changes = watchSources(
    sourcesOf(setup.sourceDirectories, [...setup.envFiles, watchedConfigFile(settings, setup)]),
  );
  const output = announcingReadiness(host, run);
  const exitCode = await served(run, { changes, output, server: run.start(serverCommand(run, output)) });
  changes.close();
  return exitCode;
}
