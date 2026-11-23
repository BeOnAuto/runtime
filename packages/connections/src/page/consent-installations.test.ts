import type { FakeMcpServer } from '@on.auto/tool-servers/testing';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import type { Added } from '../testing/additions.ts';
import { consentedOf, consentFake, consentHarnessAt } from '../testing/consents.ts';
import { ada, operationNamed, type Harness } from '../testing/harness.ts';
import {
  filesOf,
  finishingWith,
  installingFake,
  installingHarnessAt,
  installPage,
  listedToThePerson,
  requestSent,
  signedInAgainFor,
  typesOf,
  type InstallingFake,
} from '../testing/installing-consents.ts';

const anyWords: unknown = expect.any(String);

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

function installing(installations?: readonly unknown[] | null): InstallingFake {
  const made = installingFake(installations);
  closing.push(made.fake.close);
  return made;
}

function tokenRequestsAt(fake: FakeMcpServer): number {
  return fake.heard().filter(({ path }) => path === '/token').length;
}

function keptTokensIn(h: Harness): readonly string[] {
  return [...h.secrets.values().values()].filter((value) => value.includes('access_token'));
}

describe('a sign-in to connect by installing the application whoever runs Auto registered, with no installation chosen', () => {
  it('answers the installations the person can reach and the page where they install it, keeps none of their tokens and connects nothing', async () => {
    const made = installing();
    const h = installingHarnessAt(made);
    const link = await filesOf(h);
    const consented = await consentedOf(h, link);

    const finished = await finishingWith(h, link, consented);
    const installPageAsked = new URL(installPage);
    installPageAsked.searchParams.set('state', consented.state);

    expect(finished).toEqual({
      status: 'succeeded',
      output: { installations: listedToThePerson, install_page: installPageAsked.href },
    });
    expect(await typesOf(h)).not.toContain('connection_connected');
    expect(keptTokensIn(h)).toEqual([]);
  });
});

describe('a finish that names an installation of the application whoever runs Auto registered', () => {
  it('connects to the installation the person chose among those the service lists, and keeps no token of theirs', async () => {
    const made = installing();
    const h = installingHarnessAt(made);
    const link = await filesOf(h);

    const finished = await finishingWith(h, link, { ...(await consentedOf(h, link)), installation: '42' });
    const facts = await h.facts();

    expect(finished).toMatchObject({
      status: 'succeeded',
      output: { status: 'connected', installation: { id: '42', name: 'acme-labs' } },
    });
    expect(facts.slice(-1).map(({ type, data }) => [type, data])).toEqual([
      [
        'connection_connected',
        {
          connection: link.id,
          client_id: 'auto-runtime',
          client_source: 'registered',
          installation: { id: '42', name: 'acme-labs' },
          connected_by: { id: 'person:ada', name: 'Ada Lovelace' },
        },
      ],
    ]);
    expect([...h.secrets.values().keys()]).toEqual([]);
  });

  it('redeems the code of the sign-in started for the installation chosen, whatever installation the return names besides', async () => {
    const made = installing();
    const h = installingHarnessAt(made);
    const link = await filesOf(h);

    const finished = await finishingWith(h, link, {
      ...(await consentedOf(h, link)),
      installation: '42',
      parameters: { installation_id: '41' },
    });

    expect(finished).toMatchObject({ status: 'succeeded', output: { installation: { id: '42', name: 'acme-labs' } } });
    expect(tokenRequestsAt(made.fake)).toBe(1);
  });
});

describe('a return that names an installation, with none chosen, as after the service’s installation page', () => {
  it.each([
    ['with a code its installation page issued', { code: 'a-code-its-installation-page-issued' }],
    ['with no code', {}],
  ] as const)(
    'redeems no code, %s, connects nothing and answers the installation to sign in again for',
    async (_case, sent) => {
      const made = installing();
      const h = installingHarnessAt(made);
      const link = await filesOf(h);
      const { state } = await consentedOf(h, link);

      const finished = await finishingWith(h, link, {
        ...sent,
        state,
        parameters: { installation_id: '41', setup_action: 'install' },
      });

      expect(finished).toEqual({ status: 'succeeded', output: { installation: '41' } });
      expect(tokenRequestsAt(made.fake)).toBe(0);
      expect(await typesOf(h)).not.toContain('connection_connected');
    },
  );

  it('connects that installation at the second sign-in, where the service lists it, redeeming only that sign-in’s code, with its verifier', async () => {
    const made = installing();
    const h = installingHarnessAt(made);
    const link = await filesOf(h);

    const finished = await finishingWith(h, link, await signedInAgainFor(h, link, '41'));

    expect(finished).toMatchObject({
      status: 'succeeded',
      output: { status: 'connected', installation: { id: '41', name: 'acme' } },
    });
    expect(tokenRequestsAt(made.fake)).toBe(1);
  });
});

describe('an installation the service does not list for the person who signed in', () => {
  it.each([
    [
      'a returned installation the service does not list, at the second sign-in',
      (h: Harness, link: Added) => signedInAgainFor(h, link, '99'),
    ],
    [
      'a chosen installation the service does not list',
      async (h: Harness, link: Added) => ({ ...(await consentedOf(h, link)), installation: '43' }),
    ],
  ])('refuses %s, connecting nothing', async (_case, returnedTo) => {
    const made = installing();
    const h = installingHarnessAt(made);
    const link = await filesOf(h);

    const finished = await finishingWith(h, link, await returnedTo(h, link));

    expect(finished).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer: '/installation', detail: anyWords }],
    });
    expect(await typesOf(h)).not.toContain('connection_connected');
  });
});

describe('a return that says the person only asked for an installation', () => {
  it('answers that a request was sent, where the service says the person only asked for an installation, and redeems no code', async () => {
    const made = installing();
    const h = installingHarnessAt(made);
    const link = await filesOf(h);
    const { state } = await consentedOf(h, link);
    const before = tokenRequestsAt(made.fake);

    const finished = await finishingWith(h, link, { state, parameters: requestSent });

    expect(finished).toEqual({ status: 'succeeded', output: { requested: true } });
    expect(tokenRequestsAt(made.fake)).toBe(before);
    expect(await typesOf(h)).not.toContain('connection_connected');
  });

  it('is refused with no code where the way names no request', async () => {
    const made = installing();
    const h = installingHarnessAt(made, { requested: false });
    const link = await filesOf(h);
    const { state } = await consentedOf(h, link);

    expect(await finishingWith(h, link, { state, parameters: requestSent })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer: '/code', detail: anyWords }],
    });
  });
});

describe('a finish whose installations the service cannot confirm', () => {
  it.each([
    ['answers no list of them', null, {}],
    ['cannot be reached', undefined, { api: 'https://nobody.in-process.test' }],
  ] as const)('is unavailable where the service %s, connecting nothing', async (_case, installations, options) => {
    const h = installingHarnessAt(installing(installations), options);
    const link = await filesOf(h);

    expect(await finishingWith(h, link, { ...(await consentedOf(h, link)), installation: '41' })).toMatchObject({
      status: 'rejected',
      reason: 'unavailable',
    });
  });

  it('is refused where the application is no longer set up on this runtime, so no page can be offered', async () => {
    const h = installingHarnessAt(installing(), { heldHere: false });
    const link = await filesOf(h);

    expect(await finishingWith(h, link, await consentedOf(h, link))).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
    });
  });
});

describe('the finish of a connection that installs nothing, given no code', () => {
  it('is refused, asking the code or the handle', async () => {
    const fake = consentFake();
    closing.push(fake.close);
    const h = consentHarnessAt(fake);
    const link = await filesOf(h);
    const { state } = await consentedOf(h, link);

    expect(await finishingWith(h, link, { state, parameters: requestSent })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer: '/code', detail: anyWords }],
    });
  });
});

const ListedWaysSchema = Schema.Struct({
  output: Schema.Struct({
    providers: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        credentials: Schema.Array(
          Schema.Struct({
            kind: Schema.String,
            offered: Schema.Boolean,
            client_source: Schema.optionalKey(Schema.String),
          }),
        ),
      }),
    ),
  }),
});

const AddedCredentialSchema = Schema.Struct({
  output: Schema.Struct({
    credential: Schema.Struct({ kind: Schema.String, installation: Schema.optionalKey(Schema.Unknown) }),
  }),
});

async function waysWhere(registeredAsAnApplication: boolean) {
  const h = installingHarnessAt(installing(), { registeredAsAnApplication, byAKeyToo: true });
  const listed = Schema.decodeUnknownSync(ListedWaysSchema)(
    await h.call(operationNamed(h.operations, 'list_providers'), ada),
  );
  const addition = Schema.decodeUnknownSync(AddedCredentialSchema)(
    await h.call(operationNamed(h.operations, 'add_connection'), ada, { provider: 'files' }),
  );
  const { credential } = addition.output;
  return {
    listed: listed.output.providers.flatMap(({ name, credentials }) => (name === 'files' ? credentials : [])),
    added: [credential.kind, credential.installation === undefined ? 'installs nothing' : 'installs'],
  };
}

describe('the way of a provider that connects by installing the application whoever runs Auto registered', () => {
  it('is listed first and offered, through the registered client, and taken when no way is named, where the runtime holds that client registered as the application', async () => {
    expect(await waysWhere(true)).toEqual({
      listed: [
        { kind: 'authorization', offered: true, client_source: 'registered' },
        { kind: 'secret', offered: true },
      ],
      added: ['authorization', 'installs'],
    });
  });

  it('is neither listed nor taken where the runtime does not hold it, so the provider lists and takes its other ways as it would without it', async () => {
    expect(await waysWhere(false)).toEqual({
      listed: [{ kind: 'secret', offered: true }],
      added: ['secret', 'installs nothing'],
    });
  });
});
