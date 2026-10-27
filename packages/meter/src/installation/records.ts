import type { ConnectionPorts } from '@on.auto/ledger';
import type { InstallationChallenge, InstallationPublicKey, OfflineUsageReport } from '@on.auto/metering';
import type { SecretStore } from '@on.auto/secrets';

export interface InstallationStorage {
  readonly connection: ConnectionPorts;
  readonly secrets: SecretStore;
}

export interface InstallationIdentity {
  readonly clusterId: string;
  readonly publicKey: InstallationPublicKey;
  readonly installationKeyDigest: string;
}

export interface InstallationSigner extends InstallationIdentity {
  readonly proveChallenge: (challenge: InstallationChallenge) => Promise<string>;
  readonly signReport: (report: OfflineUsageReport) => Promise<string>;
}

export interface StoredIdentity extends InstallationIdentity {
  readonly secretId: string;
}
