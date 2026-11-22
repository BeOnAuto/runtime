import { documentsReadInProcess } from '@on.auto/documents/testing';

import type { CompositionParts } from '../../composition/composition-root.ts';
import { startServer } from '../../lifecycle/lifecycle.ts';
import { exitOnStartupFailure, type ServerProcess } from '../../lifecycle/run-server.ts';
import type { RunningServer } from '../../server-options/server-options.ts';
import { testComposition } from '../servers/test-compositions.ts';

export interface StartupSaid {
  readonly line: string;
  readonly exitCode: number;
}

type AwsLoading = CompositionParts['loadAws'];

/** Documents are read in this process: what reads them in a process of its own is proven in file-reads-over-http. */
function composedWith(loadAws: AwsLoading) {
  return testComposition({ documents: documentsReadInProcess, ...(loadAws === undefined ? {} : { loadAws }) });
}

/**
 * The server main starts, in this process, reading documents in it; `loadAws` hands it the AWS clients, the real ones
 * unless it is given.
 */
export function startedInProcess(env: Readonly<Record<string, string>>, loadAws?: AwsLoading): Promise<RunningServer> {
  return startServer(env, composedWith(loadAws));
}

export async function saidAtStart(
  settings: Readonly<Record<string, string>>,
  loadAws?: AwsLoading,
): Promise<StartupSaid> {
  const env = { HOST: '127.0.0.1', PORT: '0', ...settings };
  const said = { line: '', exitCode: 0 };
  const serverProcess: Pick<ServerProcess, 'stderr' | 'exit'> = {
    stderr: {
      write: (message, flushed) => {
        said.line += message;
        flushed();
        return true;
      },
    },
    exit: (code) => {
      said.exitCode = code;
    },
  };
  await startedInProcess(env, loadAws).catch(exitOnStartupFailure(serverProcess));
  return said;
}
