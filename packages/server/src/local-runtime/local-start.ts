import type { RuntimeAction, StartedBy } from '@on.auto/api';
import { Function } from 'effect';

import { coalescedSignals } from '../command-line/coalesced-signals.ts';
import { startupFailureNoticeFor } from '../command-line/failure-notice.ts';
import { servedLocally, type LocalServerHost } from '../command-line/local-server.ts';
import { release } from '../composition/release.ts';
import { stopInsistedBy, stopRequestedBy } from '../lifecycle/stop-request.ts';
import { restartMarkIn } from './background-process.ts';
import { localControlOf, runtimeHomeIn } from './local-control.ts';
import { runsInFlight } from './runs-in-flight.ts';

const signalsOfOneStop = 1000;

const serverProcess = {
  env: process.env,
  stdout: { write: () => true },
  stderr: process.stderr,
  exit: (code: number) => process.exit(code),
};

type LocalTerminal = Pick<LocalServerHost, 'depth' | 'write' | 'clock' | 'tickEvery'>;

export interface LocalStart {
  readonly home: string;
  readonly terminal: LocalTerminal;
}

export async function startedLocally(
  settings: Readonly<Record<string, string>>,
  startedBy: StartedBy,
  { home, terminal }: LocalStart,
): Promise<RuntimeAction> {
  const signals = coalescedSignals(process, signalsOfOneStop, () => performance.now());
  const restartMark = restartMarkIn(home);
  const local = localControlOf(
    {
      version: release.version,
      pid: process.pid,
      startedAt: new Date(),
      directory: process.cwd(),
      home,
      startedBy,
      port: settings['PORT'],
    },
    runsInFlight(),
    restartMark,
  );
  const asked = Promise.race([stopRequestedBy(signals).then((): RuntimeAction => 'stop'), local.asked]);
  const stopRequested = asked.then(Function.constVoid);
  const stopInsisted = stopInsistedBy(signals);
  Object.assign(process.env, settings);
  await servedLocally({
    ...terminal,
    run: async () => {
      const { compositionRoot } = await import('../composition/composition-root.ts');
      const { runServer } = await import('../lifecycle/run-server.ts');
      const { usagePingOf } = await import('../usage-ping/usage-ping.ts');
      const usagePing = usagePingOf({ fetch, runtimeHome: runtimeHomeIn(home), running: process });
      const options = { ...compositionRoot, localServingIn: local.servingIn, usagePing };
      const server = await runServer(serverProcess, options, stopRequested, stopInsisted);
      restartMark.clear(process.pid);
      return server;
    },
    stopRequested,
  }).catch(async (failure: unknown) => {
    const { exitOnStartupFailure } = await import('../lifecycle/run-server.ts');
    exitOnStartupFailure(serverProcess, startupFailureNoticeFor(serverProcess.stderr))(failure);
  });
  return asked;
}
