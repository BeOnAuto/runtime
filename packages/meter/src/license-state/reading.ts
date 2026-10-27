import { statement, type ConnectionPorts } from '@on.auto/ledger';
import { Schema } from 'effect';

import type { LicenseHead, LicenseHistory } from './records.ts';

const storedNumber = Schema.Union([Schema.Number, Schema.FiniteFromString]);
const headRow = Schema.decodeUnknownSync(
  Schema.Tuple([
    Schema.Struct({
      revision: storedNumber,
      generation: storedNumber,
      state: Schema.Literals(['unlicensed', 'active', 'refused']),
      account_id: Schema.NullOr(Schema.String),
      installation_id: Schema.NullOr(Schema.String),
      serial: Schema.NullOr(Schema.String),
    }),
  ]),
);
const historyRows = Schema.decodeUnknownSync(
  Schema.Array(
    Schema.Struct({
      serial: Schema.String,
      generation: storedNumber,
      revision: storedNumber,
      token: Schema.String,
      challenge_payload: Schema.String,
      allocation_json: Schema.String,
    }),
  ),
);

export async function readLicenseHead(connection: Pick<ConnectionPorts, 'read'>): Promise<LicenseHead> {
  const [row] = headRow(
    await connection.read(statement`SELECT revision, generation, state, account_id, installation_id, serial
    FROM meter_license_head WHERE id = 1`),
  );
  return {
    revision: row.revision,
    generation: row.generation,
    state: row.state,
    accountId: row.account_id,
    installationId: row.installation_id,
    serial: row.serial,
  };
}

export async function readLicenseHistory(
  connection: Pick<ConnectionPorts, 'read'>,
  serial: string,
): Promise<LicenseHistory | undefined> {
  const [row] = historyRows(
    await connection.read(statement`SELECT serial, generation, revision, token, challenge_payload, allocation_json
    FROM meter_license_history WHERE serial = ${serial}`),
  );
  return row === undefined
    ? undefined
    : {
        serial: row.serial,
        generation: row.generation,
        revision: row.revision,
        token: row.token,
        challengePayload: row.challenge_payload,
        allocationJson: row.allocation_json,
      };
}
