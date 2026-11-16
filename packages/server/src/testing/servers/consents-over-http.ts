import type { FakeMcpServer } from '@on.auto/tool-servers/served-fakes';
import { consentSecret } from '@on.auto/tool-servers/testing';
import { Schema } from 'effect';

import { aPortNothingListensOn } from '../processes/free-port.ts';
import type { TestResponse } from './http-client.ts';
import type { ReasoningServer } from './reasoning-server.ts';

const AddedSchema = Schema.Struct({ id: Schema.String, connect: Schema.Struct({ url: Schema.String }) });

const StartedSchema = Schema.Struct({ authorize: Schema.Struct({ url: Schema.String }) });

export interface AddedLink {
  readonly id: string;
  readonly token: string;
}

export interface StartedConsent extends AddedLink {
  readonly authorize: URL;
}

export interface Consenting {
  readonly org?: string;
  readonly key?: string;
  readonly provider?: string;
}

export interface ServedStudioReturn {
  readonly port: number;
  readonly returnAddress: string;
}

export async function servedStudioReturn(): Promise<ServedStudioReturn> {
  const port = await aPortNothingListensOn();
  return { port, returnAddress: `http://127.0.0.1:${port}/studio/connect-return` };
}

export function linkAddedBy({ body }: TestResponse): AddedLink {
  const { id, connect } = Schema.decodeUnknownSync(AddedSchema)(body);
  return { id, token: String(new URL(connect.url).searchParams.get('token')) };
}

function connectionsOf({ org = 'local' }: Consenting): string {
  return `/v1/orgs/${org}/connections`;
}

function keyedBy({ key }: Consenting): { readonly key?: string } {
  return key === undefined ? {} : { key };
}

export async function consentStartedFrom(
  served: ReasoningServer,
  link: AddedLink,
  consenting: Consenting = {},
): Promise<StartedConsent> {
  const started = await served.call('POST', `${connectionsOf(consenting)}/${link.id}/consent`, {
    ...keyedBy(consenting),
    body: { token: link.token },
  });
  return { ...link, authorize: new URL(Schema.decodeUnknownSync(StartedSchema)(started.body).authorize.url) };
}

export async function consentStartedBy(served: ReasoningServer, consenting: Consenting = {}): Promise<StartedConsent> {
  const { provider = 'files' } = consenting;
  const link = linkAddedBy(
    await served.call('POST', connectionsOf(consenting), { ...keyedBy(consenting), body: { provider } }),
  );
  return consentStartedFrom(served, link, consenting);
}

export async function consentFinishedBy(
  served: ReasoningServer,
  { id, token }: AddedLink,
  authorizeAt: string,
  consenting: Consenting = {},
): Promise<string> {
  const back = new URL(String((await fetch(authorizeAt, { redirect: 'manual' })).headers.get('location')));
  const [code, state, iss] = ['code', 'state', 'iss'].map((name) => String(back.searchParams.get(name)));
  await served.call('POST', `${connectionsOf(consenting)}/${id}/consent/code`, {
    ...keyedBy(consenting),
    body: { token, code, state, iss },
  });
  return id;
}

export async function connectedByConsent(served: ReasoningServer, consenting: Consenting = {}): Promise<string> {
  const started = await consentStartedBy(served, consenting);
  return consentFinishedBy(served, started, started.authorize.href, consenting);
}

export interface GroupOfMore {
  readonly name: string;
  readonly for: string;
  readonly scope: string;
  readonly says: Readonly<Record<string, string>>;
}

export function filesProvidedBy(
  fake: FakeMcpServer,
  more: readonly GroupOfMore[] = [],
): Readonly<Record<string, string>> {
  return {
    CONNECTIONS: JSON.stringify({
      allowed_hosts: ['127.0.0.1'],
      registered_clients: [
        { issuers: [fake.origin], client_id: 'auto-runtime', client_secret: '${FILES_CLIENT_SECRET}' },
      ],
      providers: [
        {
          name: 'files',
          title: 'Files',
          description: 'Read the files of an account.',
          website: 'https://developer.files.example.com',
          type: 'mcp',
          url: fake.url,
          credentials: [
            {
              kind: 'authorization',
              issuer: fake.origin,
              scope: 'files.read',
              says: { 'files.read': 'Read the files of the account.' },
              ...(more.length === 0 ? {} : { more }),
            },
          ],
        },
      ],
    }),
    FILES_CLIENT_SECRET: consentSecret,
  };
}
