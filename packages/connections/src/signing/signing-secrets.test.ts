import { localDeveloperId, type CallerIdentity, type Outcome } from '@on.auto/operations';
import type { SecretKeepingFailure } from '@on.auto/tool-servers';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { added, crm, issuesIn, lastFact, notes } from '../testing/additions.ts';
import { acmeWriter, ada, grace, harness, operationNamed, type Harness } from '../testing/harness.ts';

const givenSecret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';

const firstMoment = '2026-10-15T14:00:00.000Z';

const anHourLater = '2026-10-15T15:00:00.000Z';

const aDayAfterTheChange = '2026-10-16T15:00:00.000Z';

const agent: CallerIdentity = {
  ...ada,
  client: { id: 'https://agent.example/oauth/client.json', name: 'An agent', domain: 'agent.example' },
};

interface Acting {
  readonly caller?: CallerIdentity;
  readonly at?: string;
}

function setting(h: Harness, input: unknown, { caller = ada, at = firstMoment }: Acting = {}) {
  return h.call(operationNamed(h.operations, 'set_connection_signing_secret'), caller, input, at);
}

function removing(h: Harness, input: unknown, { caller = ada, at = firstMoment }: Acting = {}) {
  return h.call(operationNamed(h.operations, 'remove_connection_signing_secret'), caller, input, at);
}

function reading(h: Harness, id: string) {
  return h.call(operationNamed(h.operations, 'get_connection'), ada, { id });
}

const storeSilent: SecretKeepingFailure = { _tag: 'keeper_unavailable', detail: 'The store did not answer' };

const MadeSchema = Schema.Struct({ output: Schema.Struct({ secret: Schema.String }) });

function madeIn(outcome: Outcome): string {
  return Schema.decodeUnknownSync(MadeSchema)(outcome).output.secret;
}

function heldValues(h: Harness): readonly string[] {
  return [...h.secrets.values().values()];
}

describe('a signing secret the runtime makes', () => {
  it('is 32 random bytes as whsec_ and base64, answered this once, kept sealed, and named by its id alone in the fact', async () => {
    const h = harness();
    const { id } = await added(h, notes);

    const set = await setting(h, { id });
    const secret = madeIn(set);
    const read = await reading(h, id);

    expect(secret).toMatch(/^whsec_[A-Za-z0-9+/]{43}=$/u);
    expect(set).toMatchObject({
      status: 'succeeded',
      output: { id, signing_secret: { set_at: firstMoment, previous_until: null } },
    });
    expect(heldValues(h)).toEqual([secret]);
    expect(await lastFact(h)).toEqual({ connection: id, secret_id: 'secret-1' });
    expect(read).toMatchObject({ output: { signing_secret: { set_at: firstMoment, previous_until: null } } });
    expect(JSON.stringify(read)).not.toContain(secret);
    expect(JSON.stringify(await h.facts())).not.toContain(secret);
  });
});

describe('a signing secret the service made', () => {
  it('is kept as it is given and never answered back', async () => {
    const h = harness();
    const { id } = await added(h, notes);

    const set = await setting(h, { id, secret: givenSecret });

    expect(set).toMatchObject({ status: 'succeeded', output: { signing_secret: { set_at: firstMoment } } });
    expect(set).not.toHaveProperty('output.secret');
    expect(heldValues(h)).toEqual([givenSecret]);
  });

  it('is refused at its field unless it is whsec_ and the base64 of 24 to 64 bytes, keeping and recording nothing', async () => {
    const h = harness();
    const { id } = await added(h, notes);
    const factsBefore = (await h.facts()).length;

    const refused = await Promise.all(
      ['MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw', 'whsec_c2hvcnQ=', 'a shared password'].map((secret) =>
        setting(h, { id, secret }),
      ),
    );

    expect(refused.map((outcome) => issuesIn(outcome))).toEqual(
      Array.from({ length: 3 }, () => [
        {
          pointer: '/secret',
          detail:
            'Expected a signing secret as the Standard Webhooks specification writes one: whsec_ and the base64 of 24 to 64 random bytes',
        },
      ]),
    );
    expect(heldValues(h)).toEqual([]);
    expect((await h.facts()).length).toBe(factsBefore);
  });
});

describe('a signing secret the store does not keep', () => {
  it('is refused at its field in the words of the secret store where the store will not keep it', async () => {
    const h = harness({ mostSecretCharacters: 30 });
    const { id } = await added(h, notes);

    const refused = await setting(h, { id, secret: givenSecret });

    expect(refused).toMatchObject({ status: 'rejected', reason: 'invalid_input' });
    expect(issuesIn(refused).map(({ pointer }) => pointer)).toEqual(['/secret']);
  });

  it('is answered unavailable in the words of a secret store that cannot keep it now, the connection left as it was', async () => {
    const h = harness();
    const { id } = await added(h, notes);
    const unkeeping = h.operationsWith({
      secrets: { ...h.secrets, keep: () => Effect.fail(storeSilent) },
    });

    const refused = await h.call(operationNamed(unkeeping, 'set_connection_signing_secret'), ada, { id });

    expect(refused).toEqual({
      status: 'rejected',
      reason: 'unavailable',
      detail:
        'The signing secret of the connection notes cannot be kept now, so it is not set: The store did not answer',
    });
    expect(await reading(h, id)).toMatchObject({ output: { signing_secret: null } });
  });
});

describe('a signing secret set again', () => {
  it('replaces the one before, which verifies too for 24 hours, and the one it replaced before that is forgotten', async () => {
    const h = harness();
    const { id } = await added(h, notes);
    const first = madeIn(await setting(h, { id }));

    const second = madeIn(await setting(h, { id }, { at: anHourLater }));
    const afterTwo = heldValues(h);
    const third = await setting(h, { id, secret: givenSecret }, { at: aDayAfterTheChange });

    expect(afterTwo).toEqual([first, second]);
    expect(await lastFact(h)).toEqual({
      connection: id,
      secret_id: 'secret-3',
      previous_until: '2026-10-17T15:00:00.000Z',
    });
    expect(third).toMatchObject({
      output: { signing_secret: { set_at: aDayAfterTheChange, previous_until: '2026-10-17T15:00:00.000Z' } },
    });
    expect(heldValues(h)).toEqual([second, givenSecret]);
  });

  it('is refused on a removed connection as a conflict, and the secret kept for it forgotten', async () => {
    const h = harness();
    const { id } = await added(h, notes);
    await h.call(operationNamed(h.operations, 'remove_connection'), ada, { id });

    expect(await setting(h, { id })).toEqual({
      status: 'rejected',
      reason: 'conflict',
      detail: 'The connection notes is removed, so it takes no signing secret',
    });
    expect(heldValues(h)).toEqual([]);
  });

  it('is refused for an id the org does not have as not found, before anything is kept', async () => {
    const h = harness();

    expect(await setting(h, { id: 'nowhere' })).toMatchObject({
      status: 'rejected',
      reason: 'not_found',
      detail: 'There is no connection nowhere in this org',
    });
    expect(heldValues(h)).toEqual([]);
  });
});

describe('who sets a signing secret', () => {
  it('is a person, whoever added the connection, and in local mode the local developer', async () => {
    const h = harness();
    const { id } = await added(h, crm);
    const local = harness({ access: 'local' });
    const developer = { ...ada, id: localDeveloperId, name: 'dev' };
    const atHome = await added(local, notes, { caller: developer });

    expect(await setting(h, { id }, { caller: grace })).toMatchObject({ status: 'succeeded' });
    expect(await setting(local, { id: atHome.id }, { caller: developer })).toMatchObject({ status: 'succeeded' });
  });

  it('is never a key, an agent acting for a person, or anyone on a runtime that signs nobody in', async () => {
    const h = harness();
    const { id } = await added(h, notes);
    const keysOnly = h.operationsWith({ access: 'keys' });

    const refused = [
      await setting(h, { id }, { caller: acmeWriter }),
      await setting(h, { id }, { caller: agent }),
      await h.call(operationNamed(keysOnly, 'set_connection_signing_secret'), ada, { id }),
    ];

    expect(refused).toEqual(
      [
        'A signing secret is set by a person in Studio, and a key cannot set one',
        'A signing secret is set by a person in Studio and never through an agent, which would then hold it',
        'This runtime signs nobody in, so no person can set the signing secret of a connection: set PUBLIC_URL, or add the server to the configuration',
      ].map((detail) => ({ status: 'rejected', reason: 'forbidden', detail })),
    );
    expect(heldValues(h)).toEqual([]);
  });
});

describe('a signing secret removed', () => {
  it('with previous, forgets only the one replaced, which then verifies no more', async () => {
    const h = harness();
    const { id } = await added(h, notes);
    await setting(h, { id, secret: givenSecret });
    const second = madeIn(await setting(h, { id }, { at: anHourLater }));

    const removed = await removing(h, { id, previous: true }, { at: anHourLater });

    expect(removed).toMatchObject({ output: { signing_secret: { set_at: anHourLater, previous_until: null } } });
    expect(await lastFact(h)).toEqual({ connection: id, which: 'previous' });
    expect(heldValues(h)).toEqual([second]);
  });

  it('without it, forgets every signing secret, and the connection receives nothing', async () => {
    const h = harness();
    const { id } = await added(h, notes);
    await setting(h, { id, secret: givenSecret });
    await setting(h, { id }, { at: anHourLater });

    const removed = await removing(h, { id });

    expect(removed).toMatchObject({ status: 'succeeded', output: { signing_secret: null } });
    expect(await lastFact(h)).toEqual({ connection: id, which: 'all' });
    expect(heldValues(h)).toEqual([]);
  });
});

describe('a removal of what a connection does not hold', () => {
  it('records nothing where the connection holds none, or no previous one, and refuses an id the org does not have', async () => {
    const h = harness();
    const { id } = await added(h, notes);
    const factsBefore = (await h.facts()).length;
    const holding = await added(h, crm);
    await setting(h, { id: holding.id, secret: givenSecret });
    const factsHolding = (await h.facts()).length;

    const outcomes = [
      await removing(h, { id }),
      await removing(h, { id, previous: true }),
      await removing(h, { id: holding.id, previous: true }),
    ];

    expect(outcomes.map(({ status }) => status)).toEqual(['succeeded', 'succeeded', 'succeeded']);
    expect((await h.facts()).length).toBe(factsHolding);
    expect(factsHolding).toBeGreaterThan(factsBefore);
    expect(await removing(h, { id: 'nowhere' })).toMatchObject({ status: 'rejected', reason: 'not_found' });
  });

  it('is done by any caller that may change the org, a key among them, since it holds and shows nothing', async () => {
    const h = harness();
    const { id } = await added(h, notes);
    await setting(h, { id, secret: givenSecret });

    expect(await removing(h, { id }, { caller: acmeWriter })).toMatchObject({ status: 'succeeded' });
  });
});

describe('a connection removed', () => {
  it('forgets its signing secrets with its credential, and answers that it holds none', async () => {
    const h = harness();
    const { id } = await added(h, notes);
    await setting(h, { id, secret: givenSecret });
    await setting(h, { id }, { at: anHourLater });

    const removed = await h.call(operationNamed(h.operations, 'remove_connection'), ada, { id });

    expect(removed).toMatchObject({ status: 'succeeded', output: { status: 'removed', signing_secret: null } });
    expect(heldValues(h)).toEqual([]);
  });
});
