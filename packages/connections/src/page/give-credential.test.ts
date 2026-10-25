import { Effect, Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeConnectionSource } from '../serving/connection-source.ts';
import { added, billing, crm, issuesIn, notes } from '../testing/additions.ts';
import { ada, grace, harness, operationNamed, type Harness, fixtureServing } from '../testing/harness.ts';
import { loopbackPolicyOf } from '../testing/loopback-policy.ts';

function giving(h: Harness, input: Readonly<Record<string, string>>, caller = ada, at?: string) {
  return h.call(operationNamed(h.operations, 'give_credential'), caller, input, at);
}

describe('giving the credential of a connection', () => {
  it('keeps exactly its value in the secret store, records its id, approves the connection and uses the link up', async () => {
    const h = harness();
    const { id, token } = await added(h, crm);

    const given = await giving(h, { id, token, value: 'Bearer crm-0f3c' });

    expect(given).toMatchObject({ status: 'succeeded', output: { id, status: 'connected' } });
    expect(given).not.toHaveProperty('output.link');
    expect([...h.secrets.values()]).toEqual([['secret-1', 'Bearer crm-0f3c']]);
    const facts = await h.facts();
    expect(facts.slice(2).map(({ type, data }) => [type, data])).toEqual([
      ['connection_approved', { connection: id }],
      ['connection_connected', { connection: id, secret_id: 'secret-1' }],
    ]);
    expect(JSON.stringify(facts)).not.toContain('crm-0f3c');
    expect(await giving(h, { id, token, value: 'Bearer crm-again' })).toMatchObject({ reason: 'not_found' });
  });

  it('names who gave the value as who connected it, beside when, which in local mode need not be who added it', async () => {
    const h = harness({ access: 'local' });
    const { id, token } = await added(h, crm);

    expect(await giving(h, { id, token, value: 'Bearer crm-0f3c' }, grace, '2026-10-15T14:04:00.000Z')).toMatchObject({
      output: {
        added_by: 'person:ada',
        connected_at: '2026-10-15T14:04:00.000Z',
        connected_by: 'person:grace',
      },
    });
    expect(await h.call(operationNamed(h.operations, 'get_connection'), ada, { id })).toMatchObject({
      output: { connected_by: 'person:grace' },
    });
  });

  it('takes the client secret of client credentials, or a private key with its algorithm, which the fact names', async () => {
    const h = harness();
    const secret = await added(h, billing);
    const key = await added(h, { ...billing, name: 'billing-key' });

    await giving(h, { id: secret.id, token: secret.token, client_secret: 'billing-client-secret' });
    await giving(h, { id: key.id, token: key.token, private_key: '-----BEGIN PRIVATE KEY-----', algorithm: 'ES256' });

    expect([...h.secrets.values().values()]).toEqual(['billing-client-secret', '-----BEGIN PRIVATE KEY-----']);
    expect((await h.facts()).at(-1)?.data).toEqual({ connection: key.id, secret_id: 'secret-2', algorithm: 'ES256' });
  });
});

const wrongFields = [
  [
    'a secret given as a client secret',
    crm,
    { client_secret: 'x' },
    'Expected value alone, the secret of a credential of the kind secret',
  ],
  [
    'client credentials given as a value',
    billing,
    { value: 'x' },
    'Expected client_secret, or private_key with its algorithm, one of the two',
  ],
  [
    'a private key without its algorithm',
    billing,
    { private_key: 'x' },
    'Expected client_secret, or private_key with its algorithm, one of the two',
  ],
] as const;

describe('a credential given in the wrong fields', () => {
  it.each(wrongFields)('is refused for %s, and nothing is kept', async (_, input, fields, detail) => {
    const h = harness();
    const { id, token } = await added(h, input);

    expect(issuesIn(await giving(h, { id, token, ...fields }))).toEqual([{ pointer: '', detail }]);
    expect(h.secrets.values().size).toBe(0);
  });

  it('refuses a value the store will not keep, at its place, and keeps nothing', async () => {
    const h = harness();
    const { id, token } = await added(h, crm);

    expect(issuesIn(await giving(h, { id, token, value: 'x'.repeat(65) }))).toEqual([
      { pointer: '/value', detail: 'A secret to keep holds more than 64 characters' },
    ]);
    expect(h.secrets.values().size).toBe(0);
  });

  it('refuses a connection that takes no credential to give, a link of another person and an expired link', async () => {
    const h = harness();
    const none = await added(h, notes);
    const { id, token } = await added(h, crm);

    expect(await giving(h, { id: none.id, token: none.token, value: 'x' })).toEqual({
      status: 'rejected',
      reason: 'conflict',
      detail: 'The connection notes takes no credential to give, so it is approved as it is',
    });
    expect(await giving(h, { id, token, value: 'x' }, grace)).toMatchObject({ reason: 'forbidden' });
    expect(await giving(h, { id, token, value: 'x' }, ada, '2026-10-15T14:10:00.000Z')).toMatchObject({
      reason: 'not_found',
    });
    expect(h.secrets.values().size).toBe(0);
  });

  it('forgets the value it kept when the connection changed before the credential was recorded', async () => {
    const removal: { run: () => Promise<unknown> } = { run: () => Promise.resolve() };
    const h = harness({ beforeKeeping: () => removal.run() });
    const { id, token } = await added(h, crm);
    removal.run = () => h.call(operationNamed(h.operations, 'remove_connection'), ada, { id });

    expect(await giving(h, { id, token, value: 'Bearer crm-0f3c' })).toMatchObject({ reason: 'not_found' });
    expect(h.secrets.values().size).toBe(0);
  });
});

const crmOfItsScheme = { ...crm, credential: { ...crm.credential, scheme: 'Bearer' } };

describe('the secret of a header that names its scheme', () => {
  it('is the token alone, kept alone, which the runtime writes after the scheme', async () => {
    const h = harness();
    const { id, token } = await added(h, crmOfItsScheme);

    expect(await giving(h, { id, token, value: 'crm-0f3c' })).toMatchObject({
      status: 'succeeded',
      output: { status: 'connected', credential: crmOfItsScheme.credential },
    });
    expect([...h.secrets.values()]).toEqual([['secret-1', 'crm-0f3c']]);
  });

  it('is refused at its place when it starts with the scheme and a space, in any case, and nothing is kept', async () => {
    const h = harness();
    const { id, token } = await added(h, crmOfItsScheme);

    expect(issuesIn(await giving(h, { id, token, value: 'bearer crm-0f3c' }))).toEqual([
      {
        pointer: '/value',
        detail: 'Paste the token alone, without Bearer before it: the runtime writes Bearer itself',
      },
    ]);
    expect(h.secrets.values().size).toBe(0);
  });
});

const billingOfNoClient = { ...billing, credential: { kind: 'client_credentials', issuer: billing.credential.issuer } };

const clientIdLacking = {
  pointer: '/client_id',
  detail:
    "Expected client_id: the connection's credential holds no client id, so it is given here with the secret or the key",
};

describe('client credentials whose client id the connection does not hold', () => {
  it('take it beside the client secret, recorded with the connection and held in its credential from then on', async () => {
    const h = harness();
    const { id, token } = await added(h, billingOfNoClient);

    const given = await giving(h, { id, token, client_id: 'acme', client_secret: 'billing-client-secret' });

    expect(given).toMatchObject({ status: 'succeeded', output: { credential: billing.credential } });
    expect((await h.facts()).at(-1)?.data).toEqual({ connection: id, secret_id: 'secret-1', client_id: 'acme' });
    expect(await h.call(operationNamed(h.operations, 'get_connection'), ada, { id })).toMatchObject({
      output: { status: 'connected', credential: billing.credential },
    });
  });

  it('take it beside a private key and its algorithm', async () => {
    const h = harness();
    const { id, token } = await added(h, billingOfNoClient);

    await giving(h, { id, token, client_id: 'acme', private_key: '-----BEGIN PRIVATE KEY-----', algorithm: 'ES256' });

    expect((await h.facts()).at(-1)?.data).toEqual({
      connection: id,
      secret_id: 'secret-1',
      algorithm: 'ES256',
      client_id: 'acme',
    });
  });

  it('are refused without it, beside whatever else is missing, and nothing is kept', async () => {
    const h = harness();
    const { id, token } = await added(h, billingOfNoClient);

    const refusals = [
      issuesIn(await giving(h, { id, token, client_secret: 'billing-client-secret' })),
      issuesIn(await giving(h, { id, token })),
    ];

    expect(refusals).toEqual([
      [clientIdLacking],
      [
        { pointer: '', detail: 'Expected client_secret, or private_key with its algorithm, one of the two' },
        clientIdLacking,
      ],
    ]);
    expect(h.secrets.values().size).toBe(0);
  });
});

describe('a client id given where the connection holds one or takes none', () => {
  it('is refused beside a secret, and beside client credentials that hold theirs, and nothing is kept', async () => {
    const h = harness();
    const secret = await added(h, crm);
    const client = await added(h, billing);

    const refusals = [
      issuesIn(await giving(h, { id: secret.id, token: secret.token, value: 'crm-0f3c', client_id: 'acme' })),
      issuesIn(await giving(h, { id: client.id, token: client.token, client_secret: 'x', client_id: 'acme' })),
    ];

    expect(refusals).toEqual([
      [{ pointer: '', detail: 'Expected value alone, the secret of a credential of the kind secret' }],
      [
        {
          pointer: '/client_id',
          detail: "Expected no client_id: the connection's credential holds its client id already",
        },
      ],
    ]);
    expect(h.secrets.values().size).toBe(0);
  });
});

describe('a client id given on the page that looks like a credential', () => {
  it('is refused at its place, saying where the secret goes, nothing is kept, and the link stays open', async () => {
    const h = harness();
    const { id, token } = await added(h, billingOfNoClient);
    const withTheSecret = { id, token, client_secret: 'billing-client-secret' };

    expect(issuesIn(await giving(h, { ...withTheSecret, client_id: 'sk-live-0123456789abcdef' }))).toEqual([
      {
        pointer: '/client_id',
        detail:
          "Looks like a credential, which a client id never is: the connection's record keeps the client id in the open, so the secret or the key goes in its own field, where it is sealed",
      },
    ]);
    expect(h.secrets.values().size).toBe(0);
    expect(await giving(h, { ...withTheSecret, client_id: 'acme' })).toMatchObject({
      status: 'succeeded',
      output: { status: 'connected', credential: billing.credential },
    });
  });
});

async function authSentBy(h: Harness, id: string) {
  const source = makeConnectionSource({
    registry: h.ledger.service,
    secrets: h.secrets,
    policy: loopbackPolicyOf({}),
    variables: new Map(),
    modelProviders: ['openai'],
    ...fixtureServing,
  });
  const listed = await Effect.runPromise(source.connectionsOf('acme'));
  const { state } = Option.getOrThrow(Option.fromNullishOr(listed.find((each) => each.id === id)));
  return state.status === 'connected' ? (await Effect.runPromise(state.server)).settings.auth : null;
}

describe('the client credentials a connection sends', () => {
  it('are its issuer, its scope and the client id given on the page as they are written, a ${…} in them too', async () => {
    const h = harness();
    const issuer = 'https://auth.billing.example.com/${NOPE:-acme}';
    const credential = { kind: 'client_credentials', issuer, scope: '${CONNECTION_CREDENTIAL}' };
    const { id, token } = await added(h, { ...billing, credential });

    await giving(h, { id, token, client_id: '${BILLING_CLIENT_ID}', client_secret: 'billing-client-secret' });

    expect(await authSentBy(h, id)).toMatchObject({
      issuer,
      client_id: '${BILLING_CLIENT_ID}',
      scope: '${CONNECTION_CREDENTIAL}',
    });
  });

  it('are the private key and the algorithm given beside it, the algorithm as it is written', async () => {
    const h = harness();
    const { id, token } = await added(h, billing);

    await giving(h, { id, token, private_key: '-----BEGIN PRIVATE KEY-----', algorithm: '${NOPE:-ES256}' });

    expect(await authSentBy(h, id)).toMatchObject({
      credential: { kind: 'private_key', algorithm: '${NOPE:-ES256}' },
    });
  });
});
