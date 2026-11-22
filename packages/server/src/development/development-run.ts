import type { Environment } from '@on.auto/config';

import type { RestartMark } from '../local-runtime/local-control.ts';
import type { ChildCommand, RunningChild, StartChild } from './children.ts';
import type { RunnerLog } from './runner-log.ts';
import type { SourceChanges, WatchedSource } from './source-changes.ts';

export interface DevelopmentSetup {
  readonly envFiles: readonly string[];
  readonly sourceDirectories: readonly string[];
  readonly serverEntry: string;
  readonly configFile: string;
  readonly startChild: StartChild;
  readonly restartMark: Pick<RestartMark, 'leave' | 'clear'>;
  /** What tells the runner a source changed: a watch of the files, unless a test hands it the changes it tells. */
  readonly watchSourcesOf?: (sources: readonly WatchedSource[]) => SourceChanges;
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
