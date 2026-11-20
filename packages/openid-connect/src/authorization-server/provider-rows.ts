export interface ModelRowKey {
  readonly model: string;
  readonly sha256: string;
}

export interface ProviderRow extends ModelRowKey {
  readonly payload: string;
  readonly grantId: string | undefined;
  readonly uid: string | undefined;
  readonly expiresAt: number | undefined;
}

export interface StoredPayload {
  readonly payload: string;
  readonly grantId: string | undefined;
  readonly consumedAt: number | undefined;
}

export interface ListedRow {
  readonly sha256: string;
  readonly payload: string;
}

export interface ProviderRows {
  readonly kept: (row: ProviderRow) => Promise<void>;
  readonly found: (key: ModelRowKey) => Promise<StoredPayload | undefined>;
  readonly listed: (model: string) => Promise<readonly ListedRow[]>;
  readonly foundByUid: (model: string, uid: string) => Promise<StoredPayload | undefined>;
  readonly consumed: (key: ModelRowKey, at: number) => Promise<boolean>;
  readonly destroyed: (key: ModelRowKey) => Promise<void>;
  readonly revokedByGrant: (model: string, grantId: string) => Promise<void>;
  readonly endedEvery: (models: readonly [string, ...string[]]) => Promise<void>;
  readonly swept: (endedBefore: number) => Promise<void>;
}
