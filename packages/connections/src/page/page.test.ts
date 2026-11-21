import { providersOf, tracker } from '@on.auto/providers/testing';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { added, billing, crm, crmKeyHelp } from '../testing/additions.ts';
import { ada, harness, type Harness, operationNamed } from '../testing/harness.ts';
import { replacingFiles } from '../testing/replacements.ts';
import { unansweredWordsOf } from './unanswered-words.ts';

const anyWords: unknown = expect.any(String);

describe('the consent of a connection whose provider another provider replaces', () => {
  it('is not started through a link that is still open, saying how it is connected again, and asks its authorization server nothing', async () => {
    const { h, after, files } = replacingFiles();
    const { id, token } = await added(h, { provider: 'files' });
    const before = await h.facts();

    const outcome = await h.call(operationNamed(after, 'start'), ada, { id, token });

    expect(outcome).toMatchObject({
      reason: 'conflict',
      detail: anyWords,
    });
    expect([await h.facts(), files.heard()]).toEqual([before, []]);
  });
});

const lead = 'The consent of the connection files cannot go on';

const host = 'auth.files.example.com';

describe('the words of a consent a server did not answer as it asks', () => {
  it('lead with the refusal and the call, and name no wait, where the host refused with a 4xx', () => {
    expect([
      unansweredWordsOf(lead, {
        step: 'registration',
        host,
        answer: { status: 400, retryAfterMs: null, errorCode: 'invalid_client_metadata' },
      }),
      unansweredWordsOf(lead, { step: 'resource_metadata', host, answer: { status: 403, retryAfterMs: null } }),
    ]).toEqual([
      `${lead}: ${host} refuses to register a client (invalid_client_metadata); its sign-in is open only to clients it already knows; connect with an API key instead, if the server takes one`,
      `${lead}: ${host} does not serve its protected resource metadata (HTTP 403); the server may take an API key instead of a sign-in`,
    ]);
  });

  it('end with the wait where the host may answer later, or where no server answered at all', () => {
    expect([
      unansweredWordsOf(lead, { step: 'registration', host, answer: { status: 429, retryAfterMs: 30_000 } }),
      unansweredWordsOf(lead, { step: 'registration', host, answer: { status: 503, retryAfterMs: null } }),
      unansweredWordsOf(lead, { step: 'registration', host, answer: { failed: 'unreachable' } }),
      unansweredWordsOf(lead),
    ]).toEqual([
      `${lead}: ${host} answered the registration of a client with HTTP 429; try again in 30 seconds`,
      `${lead}: ${host} answered the registration of a client with HTTP 503; try again in a moment`,
      `${lead}: ${host} could not be reached for the registration of a client; try again in a moment`,
      `${lead}: a server it asks did not answer; try again in a moment`,
    ]);
  });
});

const ShownSchema = Schema.Struct({
  credential: Schema.Record(Schema.String, Schema.String),
  credential_ends_with: Schema.NullOr(Schema.String),
});

const decodeRead = Schema.decodeUnknownSync(Schema.Struct({ output: ShownSchema }));

const decodeListed = Schema.decodeUnknownSync(
  Schema.Struct({ output: Schema.Struct({ connections: Schema.Array(ShownSchema) }) }),
);

function endingOf(outcome: unknown): string | null {
  return decodeRead(outcome).output.credential_ends_with;
}

async function given(h: Harness, input: Readonly<Record<string, string>>): Promise<string | null> {
  return endingOf(await h.call(operationNamed(h.operations, 'give_credential'), ada, input));
}

async function endingsShown(h: Harness, id: string): Promise<readonly (string | null)[]> {
  const listed = decodeListed(
    await h.call(operationNamed(h.operations, 'list_connections'), ada, { include_removed: true }),
  );
  const read = await h.call(operationNamed(h.operations, 'get_connection'), ada, { id });
  return [...listed.output.connections.map(({ credential_ends_with: endsWith }) => endsWith), endingOf(read)];
}

describe('the ending of a credential given', () => {
  it('is the last four characters of a secret of twelve, kept beside it, shown beside the credential and never in it', async () => {
    const h = harness();
    const { id, token } = await added(h, crm);

    expect(await given(h, { id, token, value: 'crm-key-qz7w' })).toBe('qz7w');
    expect(await endingsShown(h, id)).toEqual(['qz7w', 'qz7w']);
    expect(h.secrets.endings()).toEqual(new Map([['secret-1', 'qz7w']]));
    expect(
      decodeRead(await h.call(operationNamed(h.operations, 'get_connection'), ada, { id })).output.credential,
    ).toEqual(crm.credential);
    expect(JSON.stringify(await h.facts())).not.toContain('qz7w');
  });

  it('is not kept of a secret of eleven', async () => {
    const h = harness();
    const { id, token } = await added(h, crm);

    expect(await given(h, { id, token, value: 'crm-key-123' })).toBeNull();
    expect(await endingsShown(h, id)).toEqual([null, null]);
    expect(h.secrets.endings().size).toBe(0);
  });

  it('is kept of a client secret, and never of a private key', async () => {
    const h = harness();
    const secret = await added(h, billing);
    const key = await added(h, { ...billing, name: 'billing-key' });

    const endings = [
      await given(h, { id: secret.id, token: secret.token, client_secret: 'billing-client-secret' }),
      await given(h, {
        id: key.id,
        token: key.token,
        private_key: '-----BEGIN PRIVATE KEY-----MC4CAQAwBQYDK2VwBCIEIA',
        algorithm: 'EdDSA',
      }),
    ];

    expect(endings).toEqual(['cret', null]);
  });
});

describe('the ending of the credential of a connection removed', () => {
  it('is forgotten with the value', async () => {
    const h = harness();
    const { id, token } = await added(h, crm);
    await given(h, { id, token, value: 'crm-key-1234' });

    const removed = await h.call(operationNamed(h.operations, 'remove_connection'), ada, { id });

    expect(endingOf(removed)).toBeNull();
    expect(await endingsShown(h, id)).toEqual([null, null]);
    expect(h.secrets.endings().size).toBe(0);
  });
});

const [trackersKey] = tracker.credentials;

const formatted = { ...tracker, credentials: [{ ...trackersKey, example: 'trk_…', pattern: '^trk_[A-Za-z0-9]+$' }] };

const fromTheProvider = { provider: 'tracker', placeholders: { site: 'acme' } };

const describedByTheAgent = { ...crm, credential: { ...crm.credential, example: 'crm_…', pattern: '^crm_\\w+$' } };

function giving(h: Harness, input: Readonly<Record<string, string>>) {
  return h.call(operationNamed(h.operations, 'give_credential'), ada, input);
}

function reading(h: Harness, input: Readonly<Record<string, string>>) {
  return h.call(operationNamed(h.operations, 'read_link'), ada, input);
}

describe('the key a person gives for the pattern of its provider', () => {
  it('is refused at its place in another format, keeping nothing and leaving the link open, and taken in its format', async () => {
    const h = harness({ providers: providersOf(formatted) });
    const { id, token } = await added(h, fromTheProvider);

    const refused = await giving(h, { id, token, value: 'ghp_not-a-tracker-key' });
    const kept = [...h.secrets.values()];
    const taken = await giving(h, { id, token, value: 'trk_0f3cAcme' });

    expect(refused).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The credential cannot be taken as it is given',
      issues: [{ pointer: '/value', detail: anyWords }],
    });
    expect(kept).toEqual([]);
    expect(taken).toMatchObject({ status: 'succeeded', output: { status: 'connected' } });
    expect(taken).not.toHaveProperty('output.pattern_unmatched');
  });
});

describe('the key a person gives for the pattern an agent wrote', () => {
  it('is kept in another format, connected, and answered with pattern_unmatched, and in its format answered without it', async () => {
    const h = harness();
    const unmatched = await added(h, describedByTheAgent);
    const matched = await added(h, { ...describedByTheAgent, name: 'crm-matched' });

    const outOfFormat = await giving(h, { id: unmatched.id, token: unmatched.token, value: 'sk_live_0f3c' });
    const inFormat = await giving(h, { id: matched.id, token: matched.token, value: 'crm_0f3c' });

    expect(outOfFormat).toMatchObject({
      status: 'succeeded',
      output: { status: 'connected', pattern_unmatched: true },
    });
    expect([...h.secrets.values().values()]).toEqual(['sk_live_0f3c', 'crm_0f3c']);
    expect(inFormat).toMatchObject({ status: 'succeeded', output: { status: 'connected' } });
    expect(inFormat).not.toHaveProperty('output.pattern_unmatched');
  });
});

describe('the reading of a link of a connection by a key', () => {
  it('answers how the key is made in its credential, as the agent wrote it or as its provider gives it', async () => {
    const h = harness({ providers: providersOf(formatted) });
    const byHand = await added(h, describedByTheAgent);
    const byProvider = await added(h, fromTheProvider);

    const read = [
      await reading(h, { id: byHand.id, token: byHand.token }),
      await reading(h, { id: byProvider.id, token: byProvider.token }),
    ];

    expect(read).toMatchObject([
      {
        status: 'succeeded',
        output: { provider: null, credential: { ...crmKeyHelp, example: 'crm_…', pattern: '^crm_\\w+$' } },
      },
      {
        status: 'succeeded',
        output: {
          provider: 'tracker',
          credential: {
            instructions: trackersKey?.instructions,
            key_page: 'https://app.tracker.example.com/settings/keys',
            example: 'trk_…',
            pattern: '^trk_[A-Za-z0-9]+$',
          },
        },
      },
    ]);
  });
});
