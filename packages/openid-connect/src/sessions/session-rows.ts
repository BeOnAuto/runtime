export interface SessionRow {
  readonly sha256: string;
  readonly issuer: string;
  readonly subject: string;
  readonly createdAt: number;
  readonly lastUsedAt: number;
  readonly expiresAt: number;
}

export interface SessionUse {
  readonly sha256: string;
  readonly lastUsedAt: number;
  readonly expiresAt: number;
}

export interface SessionRows {
  readonly kept: (row: SessionRow) => Promise<void>;
  readonly found: (sha256: string, now: number) => Promise<SessionRow | undefined>;
  readonly used: (use: SessionUse) => Promise<void>;
  readonly ended: (sha256: string) => Promise<void>;
}
