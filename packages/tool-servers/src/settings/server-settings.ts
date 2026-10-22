import { servesOrg, servesPlaybook } from '@on.auto/config';
import type { Redacted } from 'effect';

import type { ConsentServed } from '../consent/consent-client.ts';

export type MintingCredential =
  | { readonly kind: 'client_secret'; readonly client_secret: Redacted.Redacted }
  | { readonly kind: 'private_key'; readonly private_key: Redacted.Redacted; readonly algorithm: string };

export interface ConsentCredential extends ConsentServed {
  readonly kind: 'consent';
}

type AuthCredential = MintingCredential | ConsentCredential;

export interface AuthSettings {
  readonly issuer: string;
  readonly client_id: string;
  readonly scope: string | null;
  readonly credential: AuthCredential;
}

export type MintingAuth = AuthSettings & { readonly credential: MintingCredential };

export type ConsentAuth = AuthSettings & { readonly credential: ConsentCredential };

interface ServedBy {
  readonly name: string;
  readonly orgs: readonly string[] | null;
  readonly playbooks: readonly string[] | null;
  readonly allowed: readonly string[] | null;
  readonly record_content: boolean;
  readonly request_id: string | null;
  readonly secrets: readonly Redacted.Redacted[];
  readonly connection: string | null;
  readonly provider: string | null;
}

export interface McpServerSettings extends ServedBy {
  readonly type: 'mcp';
  readonly url: string;
  readonly headers: ReadonlyMap<string, Redacted.Redacted>;
  readonly auth: AuthSettings | null;
}

export interface StdioServerSettings extends ServedBy {
  readonly type: 'stdio';
  readonly command: string;
  readonly args: readonly string[];
  readonly env: ReadonlyMap<string, Redacted.Redacted>;
}

export interface ShippedDocument {
  readonly text: string;
  readonly bytes: number;
}

export type ApiDocumentSource =
  | { readonly kind: 'url'; readonly url: string }
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'shipped'; readonly document: ShippedDocument };

export type DocumentsPlace =
  | { readonly kind: 'directory'; readonly path: string }
  | { readonly kind: 'shipped'; readonly byName: ReadonlyMap<string, ShippedDocument> };

export interface OpenApiServerSettings extends ServedBy {
  readonly type: 'openapi';
  readonly document: ApiDocumentSource;
  readonly base_url: string | null;
  readonly headers: ReadonlyMap<string, Redacted.Redacted>;
  readonly query_params: ReadonlyMap<string, Redacted.Redacted>;
  readonly security: ReadonlyMap<string, Redacted.Redacted>;
  readonly auth: AuthSettings | null;
}

export type ServerSettings = McpServerSettings | StdioServerSettings | OpenApiServerSettings;

export type ServerType = ServerSettings['type'];

export interface ToolServerSettings {
  readonly servers: readonly ServerSettings[];
  readonly referencedVariables: readonly string[];
}

export interface ServersScope {
  readonly org: string;
  readonly playbook: string | undefined;
}

export const everyPlaybook = '*';

type Scoped = Pick<ServedBy, 'name' | 'orgs' | 'playbooks'>;

function servesScope(server: Scoped, { org, playbook }: ServersScope): boolean {
  return playbook === undefined ? servesOrg(server, org) : servesPlaybook(server, { org, playbook });
}

export function isListedFor(server: Scoped, scope: ServersScope, named: string | undefined): boolean {
  return servesScope(server, scope) && (named === undefined || server.name === named);
}

export function shippedDocumentOf(bytes: Readonly<Uint8Array>): ShippedDocument {
  return { text: new TextDecoder().decode(bytes), bytes: bytes.byteLength };
}

export function authOf(server: ServerSettings): AuthSettings | null {
  return server.type === 'stdio' ? null : server.auth;
}
