import type { Outcome, Succeeded } from '@on.auto/operations';
import { providerListOf, providerOf } from '@on.auto/providers/testing';
import {
  consentedAt,
  registeredAt,
  servedForConsent,
  type ClientRegistration,
  type Consented,
  type FakeMcpServer,
} from '@on.auto/tool-servers/testing';
import { Schema } from 'effect';

import type { Added } from './additions.ts';
import { ada, harness, operationNamed, type Harness, type HarnessOptions } from './harness.ts';

export const studioReturn = 'https://studio.on.auto/connect/return';

export interface ConsentAt {
  readonly url: string;
  readonly expiresAt: string;
}

const StartedSchema = Schema.Struct({
  status: Schema.Literal('succeeded'),
  output: Schema.Struct({ authorize: Schema.Struct({ url: Schema.String, expires_at: Schema.String }) }),
});

export function consentFake(changes: Partial<ClientRegistration> = {}): Promise<FakeMcpServer> {
  return servedForConsent({ redirectUris: [studioReturn], ...changes });
}

const filesWay = { scope: 'files.read', parameters: { access_type: 'offline' } };

function filesAt(fake: FakeMcpServer, way: Readonly<Record<string, unknown>> = filesWay) {
  return providerOf({
    name: 'files',
    title: 'Files',
    description: 'Read the files of an account.',
    website: 'https://developer.files.example.com',
    type: 'mcp',
    url: fake.url,
    credentials: [{ kind: 'authorization', issuer: fake.origin, ...way }],
  });
}

export interface ConsentHarnessOptions extends HarnessOptions {
  readonly way?: Readonly<Record<string, unknown>>;
}

export function consentHarnessAt(fake: FakeMcpServer, { way, ...options }: ConsentHarnessOptions = {}): Harness {
  return harness({
    providers: providerListOf(filesAt(fake, way)),
    consenting: { registeredClients: [registeredAt(fake.origin)] },
    mostSecretCharacters: 4096,
    ...options,
  });
}

export function starting(h: Harness, { id, token }: Added, at?: string): Promise<Outcome<Succeeded>> {
  return h.call(operationNamed(h.operations, 'start'), ada, { id, token }, at);
}

export async function startedAt(h: Harness, link: Added, at?: string): Promise<ConsentAt> {
  const { output } = Schema.decodeUnknownSync(StartedSchema)(await starting(h, link, at));
  return { url: output.authorize.url, expiresAt: output.authorize.expires_at };
}

export function finishing(
  h: Harness,
  { id, token }: Added,
  { code, state, iss }: Consented,
  at?: string,
): Promise<Outcome<Succeeded>> {
  return h.call(operationNamed(h.operations, 'finish'), ada, { id, token, code, state, iss }, at);
}

export async function consentedOf(h: Harness, link: Added, at?: string): Promise<Consented> {
  return consentedAt((await startedAt(h, link, at)).url);
}

export function filesApiAt(fake: FakeMcpServer) {
  return providerOf({
    name: 'files-api',
    title: 'Files',
    description: 'Read the files of an account over its HTTP API.',
    website: 'https://developer.files.example.com',
    type: 'openapi',
    document: `${fake.origin}/openapi.json`,
    base_url: `${fake.origin}/v1`,
    credentials: [
      {
        kind: 'authorization',
        issuer: fake.origin,
        authorization_endpoint: `${fake.origin}/authorize`,
        token_endpoint: `${fake.origin}/token`,
        revocation_endpoint: `${fake.origin}/revoke`,
      },
    ],
  });
}
