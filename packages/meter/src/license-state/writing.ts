import { statement, type ConnectionPorts } from '@on.auto/ledger';
import { installationProofPayload, type LicenseEntitlement } from '@on.auto/metering';

import type { LicenseRecordRequest } from './records.ts';

export async function writeLicense(
  connection: ConnectionPorts,
  request: LicenseRecordRequest,
  license: LicenseEntitlement,
): Promise<boolean> {
  const attempt = crypto.randomUUID();
  const rows = await connection.transaction([
    statement`UPDATE meter_license_head SET revision = revision + 1, generation = ${license.generation},
      state = 'active', account_id = ${license.accountId}, installation_id = ${license.installationId},
      serial = ${license.serial}, attempt_id = ${attempt}
      WHERE id = 1 AND revision = ${request.expectedRevision} AND revision < 9007199254740991 AND generation < ${license.generation}
      AND (account_id IS NULL OR (account_id = ${license.accountId} AND installation_id = ${license.installationId}))`,
    statement`INSERT INTO meter_license_history (serial, generation, revision, token, challenge_payload, allocation_json, accepted_at)
      SELECT ${license.serial}, ${license.generation}, revision, ${request.entitlementToken},
        ${installationProofPayload(request.challenge)}, ${JSON.stringify(request.allocationTokens)}, ${request.now}
      FROM meter_license_head WHERE id = 1 AND attempt_id = ${attempt}
      ON CONFLICT (serial) DO NOTHING RETURNING serial`,
  ]);
  return rows.length > 0;
}

export async function refuseLicense(connection: ConnectionPorts, revision: number): Promise<boolean> {
  const rows =
    await connection.write(statement`UPDATE meter_license_head SET revision = revision + 1, state = 'refused', attempt_id = NULL
    WHERE id = 1 AND revision = ${revision} AND revision < 9007199254740991 AND state = 'active' RETURNING revision`);
  return rows.length > 0;
}
