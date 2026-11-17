import { compositionRoot } from '../../composition/composition-root.ts';
import { startServer } from '../../lifecycle/lifecycle.ts';
import { exitOnStartupFailure, type ServerProcess } from '../../lifecycle/run-server.ts';
import type { RunningServer } from '../../server-options/server-options.ts';

export interface StartupSaid {
  readonly line: string;
  readonly exitCode: number;
}

export function startedInProcess(env: Readonly<Record<string, string>>): Promise<RunningServer> {
  return startServer(env, compositionRoot);
}

export async function saidAtStart(settings: Readonly<Record<string, string>>): Promise<StartupSaid> {
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
  await startedInProcess(env).catch(exitOnStartupFailure(serverProcess));
  return said;
}
