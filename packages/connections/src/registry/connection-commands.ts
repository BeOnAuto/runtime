import type { RecordedCaller } from '@on.auto/operations';
import type { ClientSource } from '@on.auto/tool-servers';

import type { ConnectionEntry, ConnectionType } from './connection-entry.ts';
import type { Credential } from './credential.ts';
import type { OpenLink } from './registry.ts';

export interface ConnectionAddition {
  readonly type: 'add';
  readonly connection: string;
  readonly name: string;
  readonly server_type: ConnectionType;
  readonly provider: string | null;
  readonly placeholders: Readonly<Record<string, string>> | null;
  readonly entry: ConnectionEntry;
  readonly credential: Credential;
  readonly added_by: RecordedCaller;
  readonly link: OpenLink;
}

export interface LinkUse {
  readonly connection: string;
  readonly token_sha256: string;
  readonly bindsPerson: boolean;
}

interface Connecting extends LinkUse {
  readonly connected_by: RecordedCaller;
}

export interface ConnectionApproval extends Connecting {
  readonly type: 'approve';
}

export interface CredentialGiving extends Connecting {
  readonly type: 'give';
  readonly secret_id: string;
  readonly algorithm?: string;
  readonly client_id?: string;
}

export interface ConsentStart extends LinkUse {
  readonly type: 'start';
  readonly state_sha256: string;
  readonly verifier_secret_id: string;
  readonly client_id: string;
  readonly client_source: ClientSource;
  readonly expires_at: string;
}

export interface ConsentFinish extends Connecting {
  readonly type: 'finish';
  readonly state_sha256: string;
  readonly secret_id: string;
  readonly client_id: string;
  readonly client_source: ClientSource;
  readonly scope?: string;
}

export interface ConnectionRemoval {
  readonly type: 'remove';
  readonly connection: string;
}

export interface ConnectionBreaking {
  readonly type: 'break';
  readonly connection: string;
  readonly reason: string;
}

export type ConnectionCommandData =
  | ConnectionAddition
  | ConnectionApproval
  | CredentialGiving
  | ConsentStart
  | ConsentFinish
  | ConnectionRemoval
  | ConnectionBreaking;

export interface CommandMetadata {
  readonly by: string;
  readonly at: string;
}

export type ConnectionCommand = ConnectionCommandData & CommandMetadata;
