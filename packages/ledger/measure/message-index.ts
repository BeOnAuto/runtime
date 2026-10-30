import { inTurn, measuredOnEachStore, median, timed, write, type MeasuredStore } from './stores.ts';

const messages = Number(process.env['LEDGER_MEASURE_MESSAGES'] ?? '1000000');

const lookups = 1000;

const context = '{"at":"2026-10-10T09:00:00.000Z","by":"measurer"}';

function filled({ name }: MeasuredStore): string {
  return name === 'SQLite'
    ? `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${messages})
      INSERT INTO emt_messages (stream_id, stream_position, partition, message_data, message_metadata,
        message_schema_version, message_type, message_id)
      SELECT 'playbook/acme/b' || (i % 100) || '/runs/r' || (i / 2), (i % 2) + 1, 'emt:default', '{"input":null}',
        '${context}', '1', 'run_started', 'message-' || i FROM n`
    : `INSERT INTO emt_messages (stream_id, stream_position, message_data, message_metadata, message_schema_version,
        message_type, message_id, transaction_id)
      SELECT 'playbook/acme/b' || (i % 100) || '/runs/r' || (i / 2), (i % 2) + 1, jsonb_build_object('json', '{"input":null}'),
        '${context}', '1', 'run_started', 'message-' || i, pg_current_xact_id()
      FROM generate_series(1, ${messages}) AS i`;
}

async function measured(measuring: MeasuredStore): Promise<void> {
  await measuring.statement('DROP INDEX IF EXISTS ledger_messages_by_id');
  await measuring.statement(filled(measuring));
  await measuring.statement(measuring.name === 'SQLite' ? 'ANALYZE' : 'VACUUM ANALYZE emt_messages');
  const started = performance.now();
  const reopened = await measuring.opened();
  const build = performance.now() - started;
  const picked = Array.from(
    { length: lookups },
    (_, index) => `message-${(index + 1) * Math.floor(messages / lookups)}`,
  );
  const times: number[] = [];
  await inTurn(picked, async (id) => {
    const playbookKey = `playbook/acme/b${Number(id.slice('message-'.length)) % 100}/`;
    times.push(await timed(() => reopened.readRecordedEvent(playbookKey, id)));
  });
  await reopened.close();
  write(
    `| ${measuring.name} | ${messages.toLocaleString('en')} | ${(build / 1000).toFixed(2)} s | ${median(times).toFixed(3)} ms |`,
  );
}

write('| Store | Messages | The open that builds the index | A read of one event by its id, median |');
write('| --- | --- | --- | --- |');
await measuredOnEachStore(measured);
