import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { endedWhileItRuns, type RunningProcess } from './process-endings.ts';

export type RunningIn = (entry: string) => readonly RunningProcess[];

interface TestRun {
  readonly name: string;
}

type TestRunTeardown = () => Promise<void>;

interface RunningInAnEntry {
  readonly entry: string;
  readonly running: RunningProcess;
}

const nothingRuns: RunningIn = () => [];

function leftWords(left: readonly string[], ended: readonly RunningInAnEntry[]): string {
  return [
    `The tests of the run did not remove what they left in its temporary folder: ${left.join(', ')}.`,
    ...ended.map(({ entry, running }) => `The teardown ended ${running.name}, which still ran in ${entry}.`),
  ].join(' ');
}

async function checkedAndEnded(folder: string, runningIn: RunningIn): Promise<void> {
  const left = readdirSync(folder).toSorted();
  const ended = left.flatMap((entry) =>
    runningIn(join(folder, entry)).map((running): RunningInAnEntry => ({ entry, running })),
  );
  await Promise.all(ended.map(({ running }) => endedWhileItRuns(running)));
  if (left.length > 0) {
    throw new Error(leftWords(left, ended));
  }
}

export function aFolderOfTheTestRun(runningIn: RunningIn = nothingRuns): (run: TestRun) => TestRunTeardown {
  return ({ name }) => {
    const madeIn = tmpdir();
    const folder = mkdtempSync(join(madeIn, `auto-runtime-test-run-${name}-`));
    process.env['TMPDIR'] = folder;
    return async () => {
      try {
        await checkedAndEnded(folder, runningIn);
      } finally {
        rmSync(folder, { recursive: true, force: true });
        process.env['TMPDIR'] = madeIn;
      }
    };
  };
}

export default aFolderOfTheTestRun();
