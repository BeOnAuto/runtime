import type { RecordedCaller } from '@on.auto/operations';
import type { AccountType, RecordedEvents } from '@on.auto/providers';
import type { ClientSource } from '@on.auto/tool-servers';

import type { RecordedCredential } from './acting-fields.ts';
import type { ConnectionDocument, ConnectionEntry, ConnectionType } from './connection-entry.ts';
import type { IdentifiedUser, SigningSecretsRemoved } from './connection-events.ts';
import type { Account, BrokenKind } from './connection.ts';
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
  readonly document?: ConnectionDocument;
  readonly credential: Credential;
  readonly ways?: readonly RecordedCredential[];
  readonly account_type?: AccountType;
  readonly says: Readonly<Record<string, string>>;
  readonly events?: RecordedEvents;
  readonly added_by: RecordedCaller;
  readonly link: OpenLink;
}

export interface PlaybooksChoice {
  readonly playbooks?: readonly string[] | null;
}

export interface LinkUse {
  readonly connection: string;
  readonly token_sha256: string;
  readonly bindsPerson: boolean;
}

interface Connecting extends LinkUse {
  readonly connected_by: RecordedCaller;
}

export interface ConnectionApproval extends Connecting, PlaybooksChoice {
  readonly type: 'approve';
}

export interface CredentialGiving extends Connecting, PlaybooksChoice {
  readonly type: 'give';
  readonly secret_id: string;
  readonly algorithm?: string;
  readonly client_id?: string;
  readonly app_secret_ids?: Readonly<Record<string, string>>;
}

export interface WayChoice extends LinkUse {
  readonly type: 'choose_way';
  readonly credential: RecordedCredential;
  readonly says: Readonly<Record<string, string>>;
  readonly account_type?: AccountType;
}

export interface ClientGiving extends LinkUse {
  readonly type: 'give_client';
  readonly client_id: string;
  readonly secret_id: string;
}

export interface ConsentStart extends LinkUse, PlaybooksChoice {
  readonly type: 'start';
  readonly state_sha256: string;
  readonly verifier_secret_id: string;
  readonly client_id: string;
  readonly client_source: ClientSource;
  readonly expires_at: string;
  readonly scope: string | undefined;
  readonly says: Readonly<Record<string, string>>;
}

export interface ConsentFinish extends Connecting {
  readonly type: 'finish';
  readonly state_sha256: string;
  readonly secret_id: string;
  readonly client_id: string;
  readonly client_source: ClientSource;
  readonly scope?: string;
  readonly account?: Account;
}

export interface PlaybooksSetting {
  readonly type: 'set_playbooks';
  readonly connection: string;
  readonly playbooks: readonly string[] | null;
}

export interface AccountTypeSetting {
  readonly type: 'set_account_type';
  readonly connection: string;
  readonly account_type: AccountType;
}

export interface ConnectionRemoval {
  readonly type: 'remove';
  readonly connection: string;
}

export interface ConnectionBreaking {
  readonly type: 'break';
  readonly connection: string;
  readonly connected_at: string;
  readonly kind: BrokenKind;
  readonly reason: string;
}

export interface AppCredentialRefusal {
  readonly type: 'refuse_app_credential';
  readonly connection: string;
  readonly connected_at: string;
  readonly name: string;
  readonly reason: string;
}

export interface ConnectionIdentification {
  readonly type: 'identify';
  readonly connection: string;
  readonly connected_at: string;
  readonly user: IdentifiedUser;
}

export interface ConnectionReconnection {
  readonly type: 'reconnect';
  readonly connection: string;
  readonly bindsPerson: boolean;
  readonly link: OpenLink;
  readonly connected_by: RecordedCaller;
  readonly variablesSet: ReadonlySet<string>;
}

export interface ConnectionReplacement {
  readonly type: 'replace';
  readonly connection: string;
  readonly bindsPerson: boolean;
  readonly takesOver: boolean;
  readonly whilePending: boolean;
  readonly addition: ConnectionAddition;
}

export interface SigningSecretSetting {
  readonly type: 'set_signing_secret';
  readonly connection: string;
  readonly secret_id: string;
}

export interface SigningSecretRemoval {
  readonly type: 'remove_signing_secret';
  readonly connection: string;
  readonly which: SigningSecretsRemoved;
}

export type ConnectionCommandData =
  | ConnectionAddition
  | SigningSecretSetting
  | SigningSecretRemoval
  | ConnectionApproval
  | CredentialGiving
  | WayChoice
  | ClientGiving
  | ConsentStart
  | ConsentFinish
  | ConnectionRemoval
  | PlaybooksSetting
  | AccountTypeSetting
  | ConnectionBreaking
  | AppCredentialRefusal
  | ConnectionIdentification
  | ConnectionReconnection
  | ConnectionReplacement;

export type CommandDecidedApart = AppCredentialRefusal | ConnectionIdentification | AccountTypeSetting | WayChoice;

export interface CommandMetadata {
  readonly by: string;
  readonly at: string;
}

export type ConnectionCommand = ConnectionCommandData & CommandMetadata;
