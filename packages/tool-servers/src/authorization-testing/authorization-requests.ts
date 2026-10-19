import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { Schema } from 'effect';

import type { FakeMcpServer } from '../mcp-testing/fake-mcp-server.ts';

export const redirectUri = 'https://studio.example.com/connect-return';

export const clientSecret = 'auto-runtime-client-secret-3c9e';

const verifier = 'a-code-verifier-of-forty-three-characters-or-more';

const challenge = createHash('sha256').update(verifier).digest('base64url');

const decodeAnswer = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown));

export interface Answered {
  readonly status: number;
  readonly body: Readonly<Record<string, unknown>>;
}

export function basic(clientId: string, secret: string): Readonly<Record<string, string>> {
  return { authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}` };
}

export const asTheClient = basic('auto-runtime', clientSecret);

export function authorizeUrl(fake: FakeMcpServer, changes: Readonly<Record<string, string | undefined>> = {}): URL {
  const url = new URL(`${fake.origin}/authorize`);
  const parameters = {
    response_type: 'code',
    client_id: 'auto-runtime',
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'state-1',
    scope: 'files.read',
    ...changes,
  };
  for (const [name, value] of Object.entries(parameters)) {
    if (value !== undefined) {
      url.searchParams.set(name, value);
    }
  }
  return url;
}

export async function consentAt(
  fake: FakeMcpServer,
  changes: Readonly<Record<string, string | undefined>> = {},
): Promise<URL> {
  const answer = await fetch(authorizeUrl(fake, changes), { redirect: 'manual' });
  return new URL(String(answer.headers.get('location')));
}

export async function postedTo(
  fake: FakeMcpServer,
  path: string,
  form: Readonly<Record<string, string>>,
  headers: Readonly<Record<string, string>> = asTheClient,
): Promise<Answered> {
  const answer = await fetch(`${fake.origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(form),
  });
  const text = await answer.text();
  return { status: answer.status, body: text === '' ? {} : decodeAnswer(JSON.parse(text)) };
}

export async function codeOf(fake: FakeMcpServer, changes: Readonly<Record<string, string | undefined>> = {}) {
  return String((await consentAt(fake, changes)).searchParams.get('code'));
}

export function redeemed(
  fake: FakeMcpServer,
  code: string,
  headers: Readonly<Record<string, string>> = asTheClient,
  changes: Readonly<Record<string, string>> = {},
): Promise<Answered> {
  return postedTo(
    fake,
    '/token',
    { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri, ...changes },
    headers,
  );
}

export function refreshed(
  fake: FakeMcpServer,
  refreshToken: string,
  headers: Readonly<Record<string, string>> = asTheClient,
): Promise<Answered> {
  return postedTo(fake, '/token', { grant_type: 'refresh_token', refresh_token: refreshToken }, headers);
}

export async function metadataOf(fake: FakeMcpServer): Promise<Readonly<Record<string, unknown>>> {
  const answer = await fetch(`${fake.origin}/.well-known/oauth-authorization-server`);
  return decodeAnswer(await answer.json());
}

export async function admitted(fake: FakeMcpServer, token: unknown): Promise<boolean> {
  const answer = await fetch(fake.url, { method: 'DELETE', headers: { authorization: `Bearer ${String(token)}` } });
  await answer.text();
  return answer.status !== 401;
}
