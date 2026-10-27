import { statement, type Statement } from '@on.auto/ledger';
import { installationProofPayload } from '@on.auto/metering';

import type { PendingExchange } from './records.ts';

export function pendingWrite(desired: PendingExchange, previousId: string | undefined): Statement {
  const { challenge, expectedRevision } = desired;
  const payload = installationProofPayload(challenge);
  if (previousId !== undefined)
    return statement`UPDATE meter_pending_license SET challenge_id = ${challenge.id}, expected_revision = ${expectedRevision},
      challenge_payload = ${payload} WHERE id = 1 AND challenge_id = ${previousId}
      AND EXISTS (SELECT 1 FROM meter_license_head WHERE id = 1 AND revision = ${expectedRevision}
        AND (account_id IS NULL OR (account_id = ${challenge.accountId} AND installation_id = ${challenge.installationId})))
      RETURNING challenge_id`;
  return statement`INSERT INTO meter_pending_license (id, challenge_id, expected_revision, challenge_payload)
    SELECT 1, ${challenge.id}, ${expectedRevision}, ${payload} FROM meter_license_head
    WHERE id = 1 AND revision = ${expectedRevision}
    AND (account_id IS NULL OR (account_id = ${challenge.accountId} AND installation_id = ${challenge.installationId}))
    ON CONFLICT (id) DO NOTHING RETURNING challenge_id`;
}
