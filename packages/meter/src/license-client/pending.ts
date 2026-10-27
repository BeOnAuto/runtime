import { statement, type ConnectionPorts } from '@on.auto/ledger';
import { installationProofPayload } from '@on.auto/metering';
import { Schema } from 'effect';

import { readInstallationChallenge } from '../licensing/challenge.ts';
import { pendingWrite } from './pending-write.ts';
import type { PendingExchange } from './records.ts';

const pendingRows = Schema.decodeUnknownSync(
  Schema.Array(
    Schema.Struct({
      challenge_id: Schema.String,
      expected_revision: Schema.Union([Schema.Number, Schema.FiniteFromString]),
      challenge_payload: Schema.String,
    }),
  ),
);

export async function readPendingExchange(connection: ConnectionPorts): Promise<PendingExchange | undefined> {
  const [row] = pendingRows(
    await connection.read(
      statement`SELECT challenge_id, expected_revision, challenge_payload FROM meter_pending_license WHERE id = 1`,
    ),
  );
  if (row === undefined) return undefined;
  const value: unknown = JSON.parse(row.challenge_payload);
  const challenge = readInstallationChallenge(value);
  if (challenge.id !== row.challenge_id || installationProofPayload(challenge) !== row.challenge_payload)
    throw new Error('license_pending_invalid');
  return { expectedRevision: row.expected_revision, challenge };
}

function selectedPending(pending: PendingExchange | undefined, desired: PendingExchange): PendingExchange {
  if (pending === undefined) throw new Error('license_exchange_changed');
  if (
    pending.challenge.id === desired.challenge.id &&
    (pending.expectedRevision !== desired.expectedRevision ||
      installationProofPayload(pending.challenge) !== installationProofPayload(desired.challenge))
  )
    throw new Error('license_pending_conflict');
  return pending;
}

export async function keepPendingExchange(
  connection: ConnectionPorts,
  desired: PendingExchange,
  previousId?: string,
): Promise<PendingExchange> {
  try {
    await connection.write(pendingWrite(desired, previousId));
  } catch (error) {
    const existing = await readPendingExchange(connection);
    if (existing?.challenge.id === desired.challenge.id) return selectedPending(existing, desired);
    throw error;
  }
  return selectedPending(await readPendingExchange(connection), desired);
}

export async function forgetPendingExchange(connection: ConnectionPorts, challengeId: string): Promise<void> {
  await connection.write(statement`DELETE FROM meter_pending_license WHERE id = 1 AND challenge_id = ${challengeId}`);
}
