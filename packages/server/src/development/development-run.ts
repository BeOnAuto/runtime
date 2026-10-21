import type { Environment } from '@on.auto/config';

import type { RestartMark } from '../local-runtime/runtime-restarts.ts';
import type { ChildCommand, RunningChild, StartChild } from './children.ts';
import type { RunnerLog } from './runner-log.ts';

export interface DevelopmentSetup {
  readonly envFiles: readonly string[];
  readonly sourceDirectories: readonly string[];
  readonly serverEntry: string;
  readonly configFile: string;
  readonly startChild: StartChild;
  readonly restartMark: Pick<RestartMark, 'leave' | 'clear'>;
}

export interface Restarting {
  readonly servedOn: (port: number) => void;
  readonly leave: () => void;
  readonly clear: () => void;
}

export interface DevelopmentRun {
  readonly setup: DevelopmentSetup;
  readonly execPath: string;
  readonly environment: Environment;
  readonly settings: Environment;
  readonly log: RunnerLog;
  readonly stopRequested: Promise<'stop'>;
  readonly start: (command: ChildCommand) => RunningChild;
  readonly restarting: Restarting;
}
