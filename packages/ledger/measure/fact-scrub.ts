import type { FactScrub, Ledger } from '@on.auto/operations';
import {
  RemarkFactSchema,
  remarkFacts,
  remarkRows,
  topicFacts,
  topicRows,
  type RemarkFact,
  type TopicFact,
} from '@on.auto/operations/testing';
import { Effect } from 'effect';

import { makeLedger } from '../src/ledger-service.ts';
import { inTurn, measuredOnEachStore, median, timed, write, type MeasuredStore } from './stores.ts';

const messages = Number(process.env['LEDGER_MEASURE_MESSAGES'] ?? '1000000');

const playbooks = 100;

const scrubs = 100;

const notes = Number(process.env['LEDGER_MEASURE_NOTES'] ?? '10000');

const notesInAnAppend = 8;

const keyedScrubs = 20;

const stored = '{"at":"2026-11-01T09:00:00.000Z","by":"measurer"}';

const erasedContext = { at: '2026-11-01T10:00:00.000Z', by: 'measurer' };

type AnyLedger = Ledger['Service'];

type RecordedRemark = typeof RemarkFactSchema.Type;

type RecordedTopic = typeof topicFacts.eventSchema.Type;

function filled({ name }: MeasuredStore): string {
  return name === 'SQLite'
    ? `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${messages})
      INSERT INTO emt_messages (stream_id, stream_position, partition, message_data, message_metadata,
        message_schema_version, message_type, message_id)
      SELECT 'playbook/acme/b' || (i % ${playbooks}) || '/runs/r' || (i / 2), (i % 2) + 1, 'emt:default',
        '{"input":null}', '${stored}', '1', 'run_started', 'message-' || i FROM n`
    : `INSERT INTO emt_messages (stream_id, stream_position, message_data, message_metadata, message_schema_version,
        message_type, message_id, transaction_id)
      SELECT 'playbook/acme/b' || (i % ${playbooks}) || '/runs/r' || (i / 2), (i % 2) + 1,
        jsonb_build_object('json', '{"input":null}'), '${stored}', '1', 'run_started', 'message-' || i,
        pg_current_xact_id()
      FROM generate_series(1, ${messages}) AS i`;
}

function remarked(ledger: AnyLedger, stream: string, ...facts: readonly RemarkFact[]): Promise<unknown> {
  return Effect.runPromise(ledger.execute(stream, remarkFacts, facts));
}

function topics(ledger: AnyLedger, stream: string, facts: readonly TopicFact[]): Promise<unknown> {
  return Effect.runPromise(ledger.execute(stream, topicFacts, facts));
}

const remarkErased: FactScrub<RecordedRemark> = {
  eventSchema: RemarkFactSchema,
  data: { text: '' },
  erasure: { type: 'remark_erased', data: { position: 1 } },
  context: erasedContext,
};

const noteErased: FactScrub<RecordedTopic> = {
  eventSchema: topicFacts.eventSchema,
  data: { topic: 'spring', note: 'a note was erased' },
  erasure: { type: 'topic_noted', data: { topic: 'erased', note: 'a note was erased' } },
  context: erasedContext,
};

const indexes = Array.from({ length: scrubs }, (_, index) => index);

async function remarksMade(ledger: AnyLedger): Promise<void> {
  await inTurn(indexes, async (index) => {
    await remarked(ledger, `playbook/acme/b1/remarks/r${index}`, { type: 'remark_made', data: { text: 'call me' } });
    await remarked(ledger, `org/acme/remarks/r${index}`, { type: 'remark_made', data: { text: 'call me' } });
  });
}

async function notesTaken(ledger: AnyLedger): Promise<void> {
  await topics(ledger, 'playbook/acme/b2/runs/topic', [{ type: 'topic_opened', data: { topic: 'spring', at: 0 } }]);
  const appends = Array.from({ length: notes / notesInAnAppend }, (_, append) => append);
  await inTurn(appends, (append) =>
    topics(
      ledger,
      `playbook/acme/b2/notes/n${append}`,
      Array.from({ length: notesInAnAppend }, (_, index) => ({
        type: 'topic_noted',
        data: { topic: 'spring', note: `note ${append * notesInAnAppend + index}` },
      })),
    ),
  );
}

async function timesOf(count: number, work: (index: number) => Promise<unknown>): Promise<number> {
  const times: number[] = [];
  await inTurn(
    Array.from({ length: count }, (_, index) => index),
    async (index) => {
      times.push(await timed(() => work(index)));
    },
  );
  return median(times);
}

async function measured(measuring: MeasuredStore): Promise<void> {
  await measuring.statement(filled(measuring));
  await measuring.statement(measuring.name === 'SQLite' ? 'ANALYZE' : 'VACUUM ANALYZE emt_messages');
  const store = await measuring.opened({}, { projections: [remarkRows, topicRows] });
  const ledger = makeLedger(store);
  await remarksMade(ledger);
  await notesTaken(ledger);
  const appended = await timesOf(scrubs, (index) =>
    remarked(ledger, `playbook/acme/b3/remarks/r${index}`, { type: 'remark_made', data: { text: 'call me' } }),
  );
  const ofAPlaybook = await timesOf(scrubs, (index) =>
    Effect.runPromise(ledger.scrubFact(`playbook/acme/b1/remarks/r${index}`, 1, remarkErased)),
  );
  const ofAnOrg = await timesOf(scrubs, (index) =>
    Effect.runPromise(ledger.scrubFact(`org/acme/remarks/r${index}`, 1, remarkErased)),
  );
  const ofAKey = await timesOf(keyedScrubs, (index) =>
    Effect.runPromise(ledger.scrubFact(`playbook/acme/b2/notes/n${index}`, 1, noteErased)),
  );
  await store.close();
  write(
    [
      `| ${measuring.name}`,
      messages.toLocaleString('en'),
      `${appended.toFixed(2)} ms`,
      `${ofAPlaybook.toFixed(2)} ms`,
      `${ofAnOrg.toFixed(2)} ms`,
      `${ofAKey.toFixed(1)} ms |`,
    ].join(' | '),
  );
}

write(
  `| Store | Messages | An append of one fact, median | A scrub of a playbook's fact keyed by its stream, median | A scrub of an org's fact keyed by its stream, median | A scrub of a fact keyed by its mapping among ${notes.toLocaleString('en')}, median |`,
);
write('| --- | --- | --- | --- | --- | --- |');
await measuredOnEachStore(measured);
