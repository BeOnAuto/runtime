import type { Environment } from '@on.auto/config';
import { Effect, type Layer } from 'effect';

import { logsToStderr } from '../logging/log-formats.ts';

export interface RunnerLog {
  readonly info: (message: string) => void;
  readonly warn: (message: string) => void;
}

type Log = (message: string) => Effect.Effect<void>;

export function runnerLog(logs: Layer.Layer<never>): RunnerLog {
  const write = (log: Log, message: string): void => {
    Effect.runSync(log(message).pipe(Effect.annotateLogs({ source: 'dev' }), Effect.provide(logs)));
  };
  return {
    info: (message) => {
      write(Effect.logInfo, message);
    },
    warn: (message) => {
      write(Effect.logWarning, message);
    },
  };
}

export function runnerLogFor(settings: Environment): RunnerLog {
  return runnerLog(logsToStderr(settings['LOG_FORMAT'] === 'pretty' ? 'pretty' : 'json'));
}
