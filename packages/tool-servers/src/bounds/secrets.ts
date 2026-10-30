import { Buffer } from 'node:buffer';

import { Redacted } from 'effect';

import { authOf, type AuthSettings, type ServerSettings } from '../settings/server-settings.ts';

export interface Secrets {
  readonly keep: (redacted: readonly Redacted.Redacted[]) => void;
  readonly replace: (source: string, secret: string) => void;
  readonly scrub: (text: string) => string;
  readonly scrubValue: (value: unknown) => unknown;
}

const leastSecretCharacters = 8;

const redactedMark = '[redacted]';

function scrubbedEntries(
  entries: readonly (readonly [string, unknown])[],
  scrub: (text: string) => string,
): readonly (readonly [string, unknown])[] {
  const kept = new Map<string, unknown>();
  for (const [key, item] of entries) {
    const scrubbedKey = scrub(key);
    if (!kept.has(scrubbedKey)) {
      kept.set(scrubbedKey, scrubbedValueOf(item, scrub));
    }
  }
  return [...kept];
}

function scrubbedValueOf(value: unknown, scrub: (text: string) => string): unknown {
  if (typeof value === 'string') {
    return scrub(value);
  }
  if (typeof value === 'number') {
    const digits = String(value);
    const scrubbed = scrub(digits);
    return scrubbed === digits ? value : scrubbed;
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => scrubbedValueOf(item, scrub));
  }
  return typeof value === 'object' && value !== null
    ? Object.fromEntries(scrubbedEntries(Object.entries(value), scrub))
    : value;
}

function asInJson(secret: string): string {
  return JSON.stringify(secret).slice(1, -1);
}

function asInQuery(secret: string): string {
  return new URLSearchParams([['', secret]]).toString().slice(1);
}

function asInBasic(secret: string): string {
  return Buffer.from(secret).toString('base64');
}

function formsOf(secret: string): readonly string[] {
  return secret.length < leastSecretCharacters
    ? []
    : [
        asInJson(asInJson(secret)),
        asInJson(secret),
        asInQuery(secret),
        encodeURIComponent(secret),
        asInBasic(secret),
        secret,
      ];
}

function formsOfEach(secrets: readonly string[]): readonly string[] {
  return [...new Set(secrets.flatMap((secret) => formsOf(secret)))];
}

export function secretsOf(redacted: readonly Redacted.Redacted[]): Secrets {
  const kept = redacted.map((value) => Redacted.value(value));
  const heldBySource = new Map<string, readonly string[]>();
  let known = formsOfEach(kept);
  const learned = (): void => {
    known = formsOfEach([...kept, ...[...heldBySource.values()].flat()]);
  };
  const keep = (more: readonly Redacted.Redacted[]): void => {
    kept.push(...more.map((value) => Redacted.value(value)));
    learned();
  };
  const replace = (source: string, secret: string): void => {
    const [replaced] = heldBySource.get(source) ?? [];
    heldBySource.set(source, replaced === undefined ? [secret] : [secret, replaced]);
    learned();
  };
  const scrub = (text: string): string =>
    known.reduce((scrubbed, secret) => scrubbed.replaceAll(secret, redactedMark), text);
  return { keep, replace, scrub, scrubValue: (value) => scrubbedValueOf(value, scrub) };
}

function credentialOf(auth: AuthSettings | null): readonly Redacted.Redacted[] {
  const credential = auth?.credential;
  if (credential?.kind === 'client_secret') {
    return [credential.client_secret];
  }
  return credential?.kind === 'private_key' ? [credential.private_key] : [];
}

export function secretsOfServer(server: ServerSettings): readonly Redacted.Redacted[] {
  return [...server.secrets, ...credentialOf(authOf(server))];
}

export function secretsOfServers(
  servers: readonly ServerSettings[],
  besides: readonly Redacted.Redacted[] = [],
): Secrets {
  return secretsOf([...servers.flatMap((server) => secretsOfServer(server)), ...besides]);
}
