import { adverts, drive, providersOf, tracker } from '@on.auto/providers/testing';
import { describe, expect, it } from 'vitest';

import { adding } from '../testing/additions.ts';
import { ada, harness, operationNamed, type Harness } from '../testing/harness.ts';

const [driveWay] = drive.credentials;

const requiringTheOrgsApp = {
  ...drive,
  name: 'posts',
  title: 'Posts',
  credentials: [{ ...driveWay, own_app: 'required' }],
};

function harnessWithNoClientHere(): Harness {
  return harness({ providers: providersOf(adverts, drive, requiringTheOrgsApp, tracker) });
}

const unsetUp =
  'The provider drive takes consent through a client whoever runs Auto registers, which is not set up here';

describe('the org’s own app a provider’s way of consent offers, as the page lists it', () => {
  it('is optional on a way of consent a client here covers, required where the way requires it or no client here covers it, and none on another kind of way', async () => {
    const h = harnessWithNoClientHere();

    const listed = await h.call(operationNamed(h.operations, 'list_providers'), ada);

    expect(listed).toMatchObject({
      output: {
        providers: [
          {
            name: 'adverts',
            credentials: [
              { kind: 'authorization', own_app: 'optional' },
              { kind: 'secret', offered: true },
            ],
          },
          {
            name: 'drive',
            credentials: [{ kind: 'authorization', own_app: 'required', offered: true, because: unsetUp }],
          },
          { name: 'posts', credentials: [{ kind: 'authorization', own_app: 'required', offered: true }] },
          { name: 'tracker' },
        ],
      },
    });
    expect(listed).not.toHaveProperty('output.providers.0.credentials.1.own_app');
    expect(listed).not.toHaveProperty('output.providers.2.credentials.0.because');
  });
});

describe('the org’s own app a provider’s way of consent offers, where whoever runs the runtime sets the way up first', () => {
  it('is listed on a way of consent that is not offered, beside why whoever runs the runtime sets it up first', async () => {
    const sendingAToken = {
      ...drive,
      name: 'sheets',
      title: 'Sheets',
      headers: { 'X-Developer-Token': '${SHEETS_DEVELOPER_TOKEN}' },
    };
    const h = harness({ providers: providersOf(sendingAToken) });

    const listed = await h.call(operationNamed(h.operations, 'list_providers'), ada);

    expect(listed).toMatchObject({
      output: {
        providers: [
          {
            name: 'sheets',
            credentials: [
              {
                kind: 'authorization',
                own_app: 'required',
                offered: false,
                because:
                  'Whoever runs the runtime sets this up first: it sends SHEETS_DEVELOPER_TOKEN, which this runtime does not set',
              },
            ],
          },
        ],
      },
    });
  });
});

const aConnectPage: unknown = expect.stringMatching(/^https:\/\/studio\.on\.auto\/connect\?/u);

describe('a connection added under the org’s own app', () => {
  it('is recorded pending with own as the source of its client, asked or where its way takes no other, and its link asks for the app first', async () => {
    const h = harnessWithNoClientHere();

    const chosen = await adding(h, {
      provider: 'adverts',
      placeholders: { tenant: 'acme' },
      credential: { kind: 'authorization', app: 'own' },
    });
    const required = await adding(h, { provider: 'posts' });
    const uncovered = await adding(h, { provider: 'drive' });

    expect([chosen, required, uncovered]).toMatchObject([
      {
        status: 'succeeded',
        output: {
          name: 'adverts',
          status: 'pending',
          credential: {
            kind: 'authorization',
            issuer: 'https://login.adverts.example.com/acme/v2.0',
            client_source: 'own',
          },
          connect: { url: aConnectPage },
        },
      },
      { status: 'succeeded', output: { name: 'posts', credential: { client_source: 'own' } } },
      { status: 'succeeded', output: { name: 'drive', status: 'pending', credential: { client_source: 'own' } } },
    ]);
    expect(chosen).not.toHaveProperty('output.credential.client_id');
  });
});

describe('a connection asked under the org’s own app where no app is taken', () => {
  it('is refused for a way that runs under no app, and for a server given by hand', async () => {
    const h = harnessWithNoClientHere();

    const refusals = [
      await adding(h, {
        provider: 'tracker',
        placeholders: { site: 'acme' },
        credential: { kind: 'secret', app: 'own' },
      }),
      await adding(h, {
        name: 'files',
        type: 'mcp',
        entry: { url: 'https://mcp.files.example.com/mcp' },
        credential: { kind: 'authorization', app: 'own' },
      }),
    ];

    expect(refusals).toMatchObject([
      {
        status: 'rejected',
        reason: 'invalid_input',
        issues: [
          {
            pointer: '/credential/app',
            detail: "Expected no app: only an authorization credential's consent runs under an app",
          },
        ],
      },
      {
        status: 'rejected',
        reason: 'invalid_input',
        issues: [
          {
            pointer: '/credential/app',
            detail:
              "Expected no app without provider: consent runs under the org's own app at a provider, whose way says where to register it",
          },
        ],
      },
    ]);
  });
});

const byTokenOrConsent = {
  ...drive,
  name: 'repos',
  title: 'Repos',
  credentials: [driveWay, { kind: 'secret', in: 'header', name: 'Authorization', scheme: 'Bearer' }],
};

describe('a provider whose way of consent no client here covers, beside a way that takes a secret', () => {
  it('lists the way that takes a secret first, which an addition by its name alone takes, and keeps offering consent under the org’s own app', async () => {
    const h = harness({ providers: providersOf(byTokenOrConsent) });

    const listed = await h.call(operationNamed(h.operations, 'list_providers'), ada);
    const byName = await adding(h, { provider: 'repos' });
    const signingIn = { provider: 'repos', name: 'repos-signed-in', credential: { kind: 'authorization' } };
    const byConsent = await adding(h, signingIn);

    expect(listed).toMatchObject({
      output: {
        providers: [
          {
            name: 'repos',
            credentials: [
              { kind: 'secret', offered: true },
              { kind: 'authorization', offered: true, own_app: 'required' },
            ],
          },
        ],
      },
    });
    expect([byName, byConsent]).toMatchObject([
      { status: 'succeeded', output: { credential: { kind: 'secret', scheme: 'Bearer' } } },
      { status: 'succeeded', output: { credential: { kind: 'authorization', client_source: 'own' } } },
    ]);
  });
});
