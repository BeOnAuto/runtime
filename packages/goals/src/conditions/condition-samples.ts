import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import type { FilterSandbox } from '@on.auto/workflow-engine';
import {
  filterSandboxOf,
  freshInstances,
  sandboxModuleIn,
  sandboxShippedRoots,
  type ProgramRun,
} from '@on.auto/workflow-engine/dsl';

import type { ConditionedRun } from './run-conditions.ts';

const sandboxModule = await sandboxModuleIn(shippedFilesOnDisk(sandboxShippedRoots()));

export const endedAt = Date.parse('2026-11-09T09:00:00Z');

export const measured = '${ $data.status == "measured" }';

export const twentyCheckpoints =
  '${ (() => { let t = 0; for (let i = 0; i < 100000; i += 1) { t += i; } return t > 0; })() }';

export const neverEnds = '${ (() => { for (;;) {} })() }';

export interface Opened {
  readonly sandbox: FilterSandbox;
  readonly closed: () => number;
}

export function opened(clock: () => number = () => 0): Opened {
  const sandbox = filterSandboxOf(freshInstances(sandboxModule), clock);
  const counts = { closed: 0 };
  return {
    sandbox: {
      ...sandbox,
      session: async (opening) => {
        const session = await sandbox.session(opening);
        return {
          ...session,
          close: () => {
            counts.closed += 1;
            session.close();
          },
        };
      },
    },
    closed: () => counts.closed,
  };
}

export function runOf(output: unknown, entries: ConditionedRun['entries'], record = 'record-1'): ConditionedRun {
  return { record, ended_at: endedAt, output, entries };
}

export function answering(...runs: readonly ProgramRun[]): FilterSandbox {
  const answers = [...runs];
  const { sandbox } = opened();
  return {
    ...sandbox,
    session: async (opening) => ({
      ...(await sandbox.session(opening)),
      define: () => () => Promise.resolve(answers.shift() ?? { ran: 'answered', text: 'true', work: 1 }),
    }),
  };
}

export const results = (count: number) => ({
  results: Array.from({ length: count }, (_, index) => ({ issue: `MAR-${index}`, status: 'measured' })),
});
