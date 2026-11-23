import {
  asAnInstalledApp,
  asAServiceAccount,
  mail,
  providerListOf,
  providerOf,
  signingInToMail,
} from '@on.auto/providers/testing';
import { describe, expect, it } from 'vitest';

import { added, lastFact, notes, type Added } from '../testing/additions.ts';
import { ada, harness, operationNamed, type Harness } from '../testing/harness.ts';
import { waysListedOf } from '../testing/listed-ways.ts';
import { preparedOf, sourceOver } from '../testing/served-connections.ts';

const anyWords: unknown = expect.any(String);

const providers = providerListOf(providerOf(mail));

const values = { tenant: '0a1b2c3d', mailbox: 'robot@acme.example.com' };

const atTheMailbox = 'https://api.mail.example.com/v1/mailboxes/robot@acme.example.com';

const theAppsSecret = 'mail-app-secret-0123456789';

function choosing(h: Harness, { id, token }: Added, choice: Readonly<Record<string, unknown>>) {
  return h.call(operationNamed(h.operations, 'choose_way'), ada, { id, token, ...choice });
}

const asTheApp = { credential: { kind: 'client_credentials' } };

describe('the values a way asks for, as list_providers lists the way', () => {
  it('are the way’s own placeholders, each with the label of its field, beside the label of the client’s ID', async () => {
    const [signingIn, ofTheApp] = await waysListedOf(mail);

    expect(signingIn).not.toHaveProperty('placeholders');
    expect(ofTheApp).toMatchObject({
      kind: 'client_credentials',
      permissions: 'application',
      client_id_title: 'Application ID',
      placeholders: [
        { name: 'tenant', title: 'Directory ID', description: anyWords, pattern: '^[0-9a-f]{8}$', required: true },
        { name: 'mailbox', title: 'Mailbox', description: anyWords, example: 'robot@acme.example.com', required: true },
      ],
    });
  });
});

describe('choosing a way with the values it asks for', () => {
  it('records the values and the base_url they resolve to, which the connection then answers', async () => {
    const h = harness({ providers });
    const link = await added(h, { provider: 'mail' });

    const outcome = await choosing(h, link, { ...asTheApp, placeholders: values });

    expect(outcome).toMatchObject({
      status: 'succeeded',
      output: {
        id: link.id,
        placeholders: values,
        entry: { base_url: atTheMailbox },
        credential: { kind: 'client_credentials', issuer: 'https://login.mail.example.com/0a1b2c3d' },
      },
    });
    expect(await lastFact(h)).toMatchObject({ placeholders: values, base_url: atTheMailbox });
  });

  it('records the provider’s base_url, and none of the app’s values, when the sign-in is chosen again', async () => {
    const h = harness({ providers });
    const link = await added(h, { provider: 'mail', credential: { kind: 'client_credentials' }, placeholders: values });

    const outcome = await choosing(h, link, { credential: { kind: 'authorization' } });

    expect(outcome).toMatchObject({
      output: { placeholders: {}, entry: { base_url: 'https://api.mail.example.com/v1/self' } },
    });
  });
});

type Choice = Readonly<Record<string, unknown>>;

const refusals: readonly (readonly [string, Choice, string])[] = [
  [
    'a value the way asks for is left out',
    { ...asTheApp, placeholders: { tenant: '0a1b2c3d' } },
    '/placeholders/mailbox',
  ],
  ['another way is chosen with no values', asTheApp, '/placeholders/tenant'],
  [
    'a value the way does not ask for is given',
    { ...asTheApp, placeholders: { ...values, site: 'acme' } },
    '/placeholders/site',
  ],
  ['a value misses its pattern', { ...asTheApp, placeholders: { ...values, tenant: 'acme' } }, '/placeholders/tenant'],
];

describe('a way chosen with values that do not fit it', () => {
  it.each(refusals)('is refused, recording nothing, where %s', async (_case, choice, pointer) => {
    const h = harness({ providers });
    const link = await added(h, { provider: 'mail' });
    const before = await h.facts();
    const atItsPlace: unknown = expect.arrayContaining([{ pointer, detail: anyWords }]);

    expect(await choosing(h, link, choice)).toMatchObject({ reason: 'invalid_input', issues: atItsPlace });
    expect(await h.facts()).toEqual(before);
  });

  it('is refused with any value for a server given by hand, which asks for none', async () => {
    const h = harness();
    const link = await added(h, notes);

    expect(await choosing(h, link, { credential: { kind: 'none' }, placeholders: { region: 'eu' } })).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/placeholders/region', detail: anyWords }],
    });
  });
});

describe('a connection connected through the company’s own app', () => {
  it('is served at its mailbox, asking its tokens of its tenant’s issuer, with its secret in no fact and no log', async () => {
    const h = harness({ providers });
    const link = await added(h, { provider: 'mail' });
    await choosing(h, link, { ...asTheApp, placeholders: values });

    const given = await h.call(operationNamed(h.operations, 'give_credential'), ada, {
      id: link.id,
      token: link.token,
      client_id: 'mail-app',
      client_secret: theAppsSecret,
    });
    const { settings } = await preparedOf(sourceOver(h, { providers }), link.id);

    expect(given).toMatchObject({ status: 'succeeded', output: { status: 'connected' } });
    expect(settings).toMatchObject({
      base_url: atTheMailbox,
      auth: { issuer: 'https://login.mail.example.com/0a1b2c3d', client_id: 'mail-app', scope: 'mail.all' },
    });
    expect(settings.auth?.credential).toMatchObject({ kind: 'client_secret' });
    expect(JSON.stringify([given, await h.facts(), h.logged()])).not.toContain(theAppsSecret);
  });
});

describe('a way that signs an assertion, chosen for a connection that signs in', () => {
  it('is recorded with its subject resolved from the mailbox given, and listed with its steps on the pages of the service', async () => {
    const entry = { ...mail, credentials: [signingInToMail, asAServiceAccount] };
    const h = harness({ providers: providerListOf(providerOf(entry)) });
    const link = await added(h, { provider: 'mail' });

    await choosing(h, link, { credential: { kind: 'jwt_bearer' }, placeholders: { inbox: 'inbox@acme.example.com' } });
    const [, signing] = await waysListedOf(entry);

    expect(await lastFact(h)).toMatchObject({
      credential: { kind: 'jwt_bearer', permissions: 'application', subject: 'inbox@acme.example.com' },
      placeholders: { inbox: 'inbox@acme.example.com' },
    });
    expect(signing).toMatchObject({ kind: 'jwt_bearer', steps: { pages: asAServiceAccount.steps.pages } });
    expect(signing).not.toHaveProperty('subject');
    expect(signing?.['key_file']).toEqual({ format: 'json' });
  });
});

describe('a way whose key file is the private key itself in PEM, chosen for a connection that signs in', () => {
  it('is recorded with the client and the token request its values name, and listed as taking a file in PEM, naming neither', async () => {
    const entry = { ...mail, credentials: [signingInToMail, asAnInstalledApp] };
    const h = harness({ providers: providerListOf(providerOf(entry)) });
    const link = await added(h, { provider: 'mail' });

    await choosing(h, link, {
      credential: { kind: 'jwt_bearer' },
      placeholders: { app: '1234567', installation: '7' },
    });
    const [, ofTheApp] = await waysListedOf(entry);

    expect(await lastFact(h)).toMatchObject({
      credential: {
        kind: 'jwt_bearer',
        permissions: 'application',
        client_id: '1234567',
        token_request: { url: 'https://api.mail.example.com/apps/installations/7/tokens' },
      },
    });
    expect(ofTheApp).toMatchObject({ kind: 'jwt_bearer', permissions: 'application', key_file: { format: 'pem' } });
    expect(ofTheApp?.['key_file']).toEqual({ format: 'pem' });
    expect(ofTheApp).not.toHaveProperty('client_id');
    expect(ofTheApp).not.toHaveProperty('token_request');
  });
});
