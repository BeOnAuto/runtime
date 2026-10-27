import { statement, type ConnectionPorts } from '@on.auto/ledger';
import { installationKeyFingerprint, readInstallationPublicKey } from '@on.auto/metering';
import { Schema } from 'effect';

import type { StoredIdentity } from './records.ts';

const identityRow = Schema.decodeUnknownSync(
  Schema.Struct({ cluster_id: Schema.String, public_key_json: Schema.String, secret_id: Schema.String }),
);

export async function readIdentity(connection: ConnectionPorts): Promise<StoredIdentity | undefined> {
  const [value] = await connection.read(
    statement`SELECT cluster_id, public_key_json, secret_id FROM meter_identity WHERE id = 1`,
  );
  if (value === undefined) return undefined;
  const row = identityRow(value);
  const publicKey = readInstallationPublicKey(JSON.parse(row.public_key_json));
  return {
    clusterId: row.cluster_id,
    publicKey: Object.freeze(publicKey),
    installationKeyDigest: await installationKeyFingerprint(publicKey),
    secretId: row.secret_id,
  };
}

export async function keepIdentity(connection: ConnectionPorts, identity: StoredIdentity): Promise<void> {
  await connection.write(statement`INSERT INTO meter_identity (id, cluster_id, public_key_json, secret_id)
    VALUES (1, ${identity.clusterId}, ${JSON.stringify(identity.publicKey)}, ${identity.secretId})
    ON CONFLICT (id) DO NOTHING RETURNING id`);
}
