import type { Issue, Outcome, Settled, Succeeded } from '@on.auto/operations';
import { providerListOf } from '@on.auto/providers/testing';
import type { ConsentClientOptions } from '@on.auto/tool-servers';
import type { FakeMcpServer } from '@on.auto/tool-servers/served-fakes';
import { describedAccess, patientTiming, playbookToolCalls } from '@on.auto/tool-servers/testing';
import { Option, Schema } from 'effect';

import { connectionPolicyOf } from '../policy/connection-policy.ts';
import { makeConnectionSource } from '../serving/connection-source.ts';
import type { Added } from './additions.ts';
import { acmeWriter, harness, harnessPages, operationNamed, type Harness, type HarnessOptions } from './harness.ts';

export interface Called {
  readonly called: Settled<Succeeded>;
  readonly close: () => Promise<void>;
}

const KeptTokensSchema = Schema.fromJsonString(Schema.Struct({ access_token: Schema.String }));

export function byHandAt({ url }: Pick<FakeMcpServer, 'url'>) {
  return { name: 'files', type: 'mcp', entry: { url }, credential: { kind: 'authorization' } };
}

export function harnessByHand(options: HarnessOptions = {}): Harness {
  return harness({ mostSecretCharacters: 4096, ...options });
}

export function readingTheLink(h: Harness, { id, token }: Added): Promise<Outcome<Succeeded>> {
  return h.call(operationNamed(h.operations, 'read_link'), acmeWriter, { id, token });
}

export function askedOf(authorization: string): Readonly<Record<string, string>> {
  return Object.fromEntries(new URL(authorization).searchParams);
}

export function refusedKind(detail: string): readonly Issue[] {
  return [{ pointer: '/credential/kind', detail }];
}

export interface TokenRequestsSeen {
  readonly fetch: ConsentClientOptions['fetch'];
  readonly resources: () => readonly (string | null)[];
}

export function tokenRequestsSeen(): TokenRequestsSeen {
  const resources: (string | null)[] = [];
  return {
    fetch: async (...[address, init]: readonly [unknown, unknown?]) => {
      const request = new Request(String(address), Object.assign({}, init));
      if (new URL(request.url).pathname === '/token') {
        resources.push(new URLSearchParams(await request.clone().text()).get('resource'));
      }
      return globalThis.fetch(request);
    },
    resources: () => [...resources],
  };
}

export interface RewrittenAnswers {
  readonly fetch: ConsentClientOptions['fetch'];
  readonly rewrite: (written: string, rewritten: string) => void;
}

export function rewrittenAnswers(): RewrittenAnswers {
  const rewrites = new Map<string, string>();
  return {
    fetch: async (...[address, init]: readonly [unknown, unknown?]) => {
      const answer = await globalThis.fetch(String(address), Object.assign({}, init));
      const written = await answer.text();
      const rewritten = [...rewrites].reduce(
        (text, [from, to]: readonly [string, string]) => text.replaceAll(from, to),
        written,
      );
      return new Response(rewritten, answer);
    },
    rewrite: (written, rewritten) => {
      rewrites.set(written, rewritten);
    },
  };
}

export function accessTokenKeptIn(h: Harness): string {
  const kept = [...h.secrets.values().values()].find((value) => value.includes('access_token'));
  return Schema.decodeUnknownSync(KeptTokensSchema)(Option.getOrThrow(Option.fromNullishOr(kept))).access_token;
}

function sourceOf(h: Harness) {
  return makeConnectionSource({
    registry: h.ledger.service,
    secrets: h.secrets,
    policy: connectionPolicyOf({}),
    pages: harnessPages,
    variables: new Map(),
    modelProviders: [],
    providers: providerListOf(),
    providerValues: new Map(),
  });
}

export async function searchedThrough(h: Harness): Promise<Called> {
  const { access } = await describedAccess({}, { timing: patientTiming, connections: sourceOf(h), consent: h.consent });
  const called = await playbookToolCalls(access).call('execute', {
    server: 'files',
    tool: 'search',
    arguments: { query: 'acme' },
  });
  return { called, close: access.close };
}
