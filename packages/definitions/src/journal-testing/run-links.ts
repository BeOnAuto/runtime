import { PlaybookContext, PlaybookWriter, Caller, messageIdOf, type RecordedEvent } from '@on.auto/operations';
import { Effect } from 'effect';

import { runJournal, type LedgerJournal } from '../journal/run-journal.ts';
import { runDecider, runStreamNameOf } from '../runs/run-decider.ts';
import { acmeAdmin } from '../testing/callers.ts';
import type { Harness } from '../testing/harness.ts';
import { testRunId } from '../testing/run-facts.ts';

const stream = `playbook/acme/alpha/${runStreamNameOf(testRunId)}`;

export function idAt(position: number): string {
  return messageIdOf(stream, position);
}

export interface Linked {
  readonly type: string;
  readonly id: string;
  readonly causationId: string | null;
  readonly correlationId: string | null;
}

function linksOf({ type, id, causationId, correlationId }: RecordedEvent): Linked {
  return { type, id, causationId, correlationId };
}

async function recordsIn({ ledger, run }: Harness): Promise<readonly RecordedEvent[]> {
  const { records } = await run(
    Effect.orDie(
      ledger.service.readRecorded(
        { org: 'acme', playbook: 'alpha' },
        { kind: 'run', run: testRunId },
        { order: 'asc', limit: 100 },
      ),
    ),
  );
  return records;
}

export async function linksIn(definitions: Harness): Promise<readonly Linked[]> {
  return (await recordsIn(definitions)).map((record) => linksOf(record));
}

export async function endingIn(definitions: Harness): Promise<unknown> {
  return (await recordsIn(definitions)).at(-1)?.data;
}

export function journalled<A>(definitions: Harness, use: (journal: LedgerJournal) => Effect.Effect<A>): Promise<A> {
  const recording = Effect.gen(function* () {
    yield* definitions.ledger.service.execute(stream, runDecider, {
      type: 'start',
      definition_type: 'tool-user',
      name: 'caller',
      input: {},
      definition_version: 1,
      calls_tools: true,
      runId: testRunId,
      by: 'acme-admin',
      at: '2026-10-01T09:00:00.000Z',
    });
    return yield* use(
      yield* runJournal(
        testRunId,
        { startId: idAt(1), correlationId: testRunId },
        { startedAt: '2026-10-01T09:00:00.000Z', modelCallsBefore: 0, calls: [] },
      ),
    );
  }).pipe(
    Effect.provideService(PlaybookWriter, {
      execute: (relative, decider, command, lineage) =>
        definitions.ledger.service.execute(`playbook/acme/alpha/${relative}`, decider, command, lineage),
    }),
    Effect.provideService(Caller, acmeAdmin),
    Effect.provideService(PlaybookContext, { org: 'acme', playbook: 'alpha' }),
  );
  return definitions.run(Effect.orDie(recording));
}
