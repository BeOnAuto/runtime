import { servedStudio } from '@on.auto/identity/testing';
import type { Outcome, Succeeded } from '@on.auto/operations';
import { keptTokensIn } from '@on.auto/tool-servers';
import { autoClientsOf, handleOf, servedThroughAuto, type ThroughAuto } from '@on.auto/tool-servers/testing';
import { Option, Redacted } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { added, crm, type Added } from '../testing/additions.ts';
import { consentHarnessAt, startedAt, starting } from '../testing/consents.ts';
import { acmeViewer, ada, operationNamed, type Harness } from '../testing/harness.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

interface Connecting {
  readonly serving: ThroughAuto;
  readonly h: Harness;
  readonly link: Added;
}

async function throughAuto(): Promise<Connecting> {
  const serving = await servedThroughAuto();
  closing.push(serving.close);
  const h = consentHarnessAt(serving.fake, {
    consenting: { autoClients: autoClientsOf(serving.service) },
    pages: { studio: { origin: 'https://studio.example.com', served: false }, runtime: () => 'http://localhost:5555' },
  });
  return { serving, h, link: await added(h, { provider: 'files' }) };
}

function finishedWith(h: Harness, { id, token }: Added, returned: Readonly<Record<string, string>>) {
  return h.call(operationNamed(h.operations, 'finish'), ada, { id, token, ...returned });
}

function readingOf(h: Harness, { id, token }: Added): Promise<Outcome<Succeeded>> {
  return h.call(operationNamed(h.operations, 'read_link'), acmeViewer, { id, token });
}

async function returnedOf({ serving, h, link }: Connecting) {
  const { url } = await startedAt(h, link);
  return { state: String(new URL(url).searchParams.get('state')), handle: await handleOf(serving.service, url) };
}

describe('the start of a consent through Auto’s consent service', () => {
  it('answers that it began with Auto’s client, and records the digest of the state the service made', async () => {
    const connecting = await throughAuto();

    const started = await starting(connecting.h, connecting.link);
    const [fact] = (await connecting.h.facts()).slice(-1);

    expect(started).toMatchObject({ output: { client_source: 'auto' } });
    expect(fact).toMatchObject({
      type: 'connection_consent_started',
      data: { client_id: 'auto-runtime', client_source: 'auto' },
    });
  });

  it('sends the service the base of the link exactly as the link opens it', async () => {
    const serving = await servedThroughAuto();
    closing.push(serving.close);
    const h = consentHarnessAt(serving.fake, {
      consenting: { autoClients: autoClientsOf(serving.service, 'loopback') },
      pages: { studio: servedStudio, runtime: () => 'http://localhost:5555' },
    });

    await starting(h, await added(h, { provider: 'files' }));

    expect(serving.service.calls().at(-1)?.body).toMatchObject({
      return: { kind: 'loopback', base: 'http://localhost:5555/studio/' },
    });
  });
});

describe('the finish of a consent through Auto’s consent service', () => {
  it('takes the handle and the state, keeps the tokens with the connection key sealed, and connects the connection', async () => {
    const connecting = await throughAuto();
    const returned = await returnedOf(connecting);

    const finished = await finishedWith(connecting.h, connecting.link, returned);
    const [kept = ''] = [...connecting.h.secrets.values().values()];
    const key = Option.getOrUndefined(keptTokensIn(Redacted.make(kept)))?.connection_key;

    expect(finished).toMatchObject({
      status: 'succeeded',
      output: { status: 'connected', credential: { client_id: 'auto-runtime', client_source: 'auto' } },
    });
    expect(key).toMatch(/^[\w-]{43}$/u);
    expect(JSON.stringify([finished, await connecting.h.facts(), connecting.h.logged()])).not.toContain(String(key));
  });

  it('is refused at the handle where the service refuses it, as one taken already', async () => {
    const connecting = await throughAuto();
    const returned = await returnedOf(connecting);
    const other = await added(connecting.h, { provider: 'files', name: 'files-again' });
    const otherReturned = await returnedOf({ ...connecting, link: other });
    await finishedWith(connecting.h, other, otherReturned);

    expect(
      await finishedWith(connecting.h, connecting.link, { ...returned, handle: otherReturned.handle }),
    ).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/handle', detail: "Expected a handle Auto's consent service takes; it refused this one" }],
    });
  });
});

describe('a finish of the shape its start did not begin with', () => {
  it('is refused at the code for a start through Auto’s consent service, and at the handle for one with a registered client', async () => {
    const connecting = await throughAuto();
    const { state } = await returnedOf(connecting);
    const registered = consentHarnessAt(connecting.serving.fake);
    const link = await added(registered, { provider: 'files' });
    const { url } = await startedAt(registered, link);
    const registeredState = String(new URL(url).searchParams.get('state'));

    expect([
      await finishedWith(connecting.h, connecting.link, { state, code: 'a-code' }),
      await finishedWith(registered, link, { state: registeredState, handle: 'a-handle' }),
    ]).toMatchObject([
      {
        reason: 'invalid_input',
        issues: [
          {
            pointer: '/code',
            detail:
              "Expected handle: the consent of the connection files began through Auto's consent service, which answers a handle, not a code",
          },
        ],
      },
      {
        reason: 'invalid_input',
        issues: [
          {
            pointer: '/handle',
            detail:
              'Expected code: the consent of the connection files began with the client whoever runs this runtime registered, which answers a code, not a handle',
          },
        ],
      },
    ]);
  });
});

describe('the source a link says a start would take', () => {
  it('is Auto’s where the service serves the issuer, the registered client where one is registered, and none for a credential given by hand', async () => {
    const connecting = await throughAuto();
    const registered = consentHarnessAt(connecting.serving.fake);
    const byHand = await added(connecting.h, crm);

    expect([
      await readingOf(connecting.h, connecting.link),
      await readingOf(registered, await added(registered, { provider: 'files' })),
      await readingOf(connecting.h, byHand),
    ]).toMatchObject([
      { output: { client_source: 'auto' } },
      { output: { client_source: 'registered' } },
      { output: { name: 'crm' } },
    ]);
    expect(await readingOf(connecting.h, byHand)).not.toHaveProperty('output.client_source');
  });
});

describe('the removal of a connection connected through Auto’s consent service', () => {
  it('revokes its tokens through the service before it forgets them', async () => {
    const connecting = await throughAuto();
    await finishedWith(connecting.h, connecting.link, await returnedOf(connecting));

    await connecting.h.call(operationNamed(connecting.h.operations, 'remove_connection'), ada, {
      id: connecting.link.id,
    });

    expect(connecting.serving.service.calls().map(({ path }) => path)).toContain('/tokens/revoke');
    expect(connecting.h.secrets.values().size).toBe(0);
  });
});
