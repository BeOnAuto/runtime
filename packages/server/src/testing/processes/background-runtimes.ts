import { endedWhileItRuns } from '@on.auto/operations/testing';
import { onTestFinished } from 'vitest';

import { until } from '../waiting/until.ts';
import { runtimesStillRunningInTheBackgroundIn, startedInTheBackgroundIn } from './runtimes-in-the-background.ts';

export interface StartedInTheBackground {
  readonly pid: () => Promise<number>;
}

export function runtimesStartedInTheBackgroundEndedWithTheTest(home: string): StartedInTheBackground {
  onTestFinished(async () => {
    await Promise.all(runtimesStillRunningInTheBackgroundIn(home).map((running) => endedWhileItRuns(running)));
  });
  const read = { starts: 0 };
  return {
    pid: async () => {
      const started = await until(
        () => startedInTheBackgroundIn(home),
        (starts) => starts.length > read.starts,
      );
      read.starts = started.length;
      return Number(started.map(({ pid }) => pid).at(-1));
    },
  };
}
