import type { AppendedScope } from '@on.auto/operations';
import { runFacts, type RunFact } from '@on.auto/operations/testing';
import { Effect } from 'effect';

import { onTheLedgerOf } from './opened-ledger-file.ts';
import { alpha, pinnedStreams } from './pinned-scenario.ts';

export const failedRun: RunFact = { type: 'run_ended', data: { status: 'failed', ms: 10, tokens: null } };

const ofThePlaybook: AppendedScope = { kind: 'playbook', playbook: alpha };

interface ReadBack {
  readonly appended: readonly { readonly stream: string; readonly type: string; readonly data: unknown }[];
  readonly version: number;
  readonly openRuns: number;
}

export function appendedAndReadBack(fileName: string): Promise<ReadBack> {
  return onTheLedgerOf(fileName, async ({ ledger }) => {
    const ended = await Effect.runPromise(ledger.readAppendedFacts(ofThePlaybook, { most: 10, dataOf: [] }));
    await Effect.runPromise(ledger.execute(pinnedStreams.openRun, runFacts, [failedRun]));
    const [appended, run, openRuns] = await Effect.runPromise(
      Effect.all([
        ledger.readAppendedFacts(ofThePlaybook, { after: ended.cursor, most: 10, dataOf: [failedRun.type] }),
        ledger.load(pinnedStreams.openRun, runFacts),
        ledger.countProjectedRows('run_tallies', alpha, [{ column: 'open', equals: true }]),
      ]),
    );
    return {
      appended: appended.facts.map(({ stream, type, data }) => ({ stream, type, data })),
      version: run.version,
      openRuns,
    };
  });
}
