import {
  PlaybookContext,
  Caller,
  messageIdOf,
  playbookLedgerOf,
  type RecordedEvent,
  runStreamNameOf,
} from '@on.auto/operations';
import { Effect, Option } from 'effect';

import { runJournal, type LedgerJournal } from '../journal/run-journal.ts';
import { decidedIn } from '../read-model-testing/in-the-playbook.ts';
import { runDecider } from '../runs/run-decider.ts';
import { fencingTokenOf, startedRunOf } from '../runs/run-state.ts';
import { acmeAdmin, recordedAdmin } from '../testing/callers.ts';
import type { Harness } from '../testing/harness.ts';
import { testRunId } from '../testing/run-facts.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const callerId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8ca1';

export const journalledStream = `definition/acme/${callerId}/${runStreamNameOf(testRunId)}`;

export function idAt({ ledger }: Pick<Harness, 'ledger'>, position: number): string {
  const ofTheRun = ledger.streamNames().find((name) => name.endsWith(`/${runStreamNameOf(testRunId)}`));
  return messageIdOf(Option.getOrThrow(Option.fromNullishOr(ofTheRun)), position);
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
    yield* decidedIn(definitions.ledger.service, alpha, 'tool-user', {
      type: 'create',
      name: 'caller',
      content: { source: 'x' },
      created_by: recordedAdmin,
      definition_id: callerId,
      by: acmeAdmin.id,
      at: '2026-10-01T09:00:00.000Z',
    });
    const { state } = yield* definitions.ledger.service.execute(journalledStream, runDecider, {
      type: 'start',
      definition_type: 'tool-user',
      name: 'caller',
      input: {},
      started_by: { id: 'acme-admin', name: 'acme-admin' },
      playbook: 'alpha',
      definition_version: 1,
      calls_tools: true,
      runId: testRunId,
      by: 'acme-admin',
      at: '2026-10-01T09:00:00.000Z',
    });
    return yield* use(
      yield* runJournal(
        testRunId,
        { startId: messageIdOf(journalledStream, 1), correlationId: testRunId },
        { startedAt: '2026-10-01T09:00:00.000Z', modelCallsBefore: 0, calls: [] },
        fencingTokenOf(startedRunOf(state)),
      ),
    );
  }).pipe(
    Effect.provideContext(playbookLedgerOf(definitions.ledger.service, alpha)),
    Effect.provideService(Caller, acmeAdmin),
    Effect.provideService(PlaybookContext, alpha),
  );
  return definitions.run(Effect.orDie(recording));
}
