import { statement, type ConnectionPorts } from '@on.auto/ledger';
import { Schema } from 'effect';

const row = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown));
const storedReport = Schema.decodeUnknownSync(
  Schema.Tuple([
    Schema.Struct({
      sequence: Schema.Union([Schema.Number, Schema.FiniteFromString]),
      snapshot_revision: Schema.Union([Schema.Number, Schema.FiniteFromString]),
      charge_revision: Schema.Union([Schema.Number, Schema.FiniteFromString]),
      checkpoint: Schema.String,
      payload_json: Schema.String,
      signed_report: Schema.String,
    }),
  ]),
);

export function alteredReportRead(
  connection: ConnectionPorts,
  pattern: string,
  change: (rows: readonly unknown[]) => readonly unknown[],
): ConnectionPorts {
  const altered =
    (read: ConnectionPorts['read']): ConnectionPorts['read'] =>
    async (sql) => {
      const rows = await read(sql);
      return sql.strings.join('').includes(pattern) ? change(rows) : rows;
    };
  return {
    ...connection,
    read: altered(connection.read),
    readConsistently: (reads) => connection.readConsistently((read) => reads(altered(read))),
  };
}

export function reportFields(fields: Readonly<Record<string, unknown>>) {
  return (rows: readonly unknown[]) => rows.map((value) => ({ ...row(value), ...fields }));
}

export async function reportEvidence(connection: ConnectionPorts) {
  const [report] = storedReport(
    await connection.read(statement`SELECT sequence, snapshot_revision,
    charge_revision, checkpoint, payload_json, signed_report FROM meter_local_reports ORDER BY sequence LIMIT 1`),
  );
  return report;
}
