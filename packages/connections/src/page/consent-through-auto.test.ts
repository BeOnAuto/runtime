import { servedStudio } from '@on.auto/identity/testing';
import type { Outcome } from '@on.auto/operations';
import { keptTokensIn, type ConsentClientOptions, type KeptTokens, type ReturnKind } from '@on.auto/tool-servers';
import { servedThroughAuto, type ThroughAuto } from '@on.auto/tool-servers/served-fakes';
import { autoClientsOf, failingAt, handleOf, serviceCallsAt } from '@on.auto/tool-servers/testing';
import { Effect, Option, Redacted } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { added, crm, type Added } from '../testing/additions.ts';
import { consentHarnessAt, startedAt, starting } from '../testing/consents.ts';
import { acmeWriter, ada, operationNamed, type Harness, loopbackAndCrmPolicy } from '../testing/harness.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

interface Connecting {
  readonly serving: ThroughAuto;
  readonly h: Harness;
  readonly link: Added;
}

async function throughAuto(consenting: Partial<ConsentClientOptions> = {}): Promise<Connecting> {
  const serving = await servedThroughAuto();
  closing.push(serving.close);
  const h = consentHarnessAt(serving.fake, {
    policy: loopbackAndCrmPolicy,
    consenting: { autoClients: autoClientsOf(serving.service), ...consenting },
    pages: { studio: { origin: 'https://studio.example.com', served: false }, runtime: () => 'http://localhost:5555' },
  });
  return { serving, h, link: await added(h, { provider: 'files' }) };
}

function finishedWith(h: Harness, { id, token }: Added, returned: Readonly<Record<string, string>>) {
  return h.call(operationNamed(h.operations, 'finish'), ada, { id, token, ...returned });
}

function readingOf(h: Harness, { id, token }: Added): Promise<Outcome> {
  return h.call(operationNamed(h.operations, 'read_link'), acmeWriter, { id, token });
}

async function returnedOf({ serving, h, link }: Connecting) {
  const { url } = await startedAt(h, link);
  return { state: String(new URL(url).searchParams.get('state')), handle: await handleOf(serving.service, url) };
}

async function listingAnotherClient(...[address, init]: readonly [unknown, unknown?]): Promise<Response> {
  const answer = await globalThis.fetch(String(address), Object.assign({}, init));
  const listing = new URL(String(address)).pathname === '/clients';
  return listing
    ? new Response((await answer.text()).replace('auto-runtime', 'a-client-listed-before'), answer)
    : answer;
}

async function connectedAt(connecting: Connecting): Promise<KeptTokens> {
  await finishedWith(connecting.h, connecting.link, await returnedOf(connecting));
  const [kept = ''] = [...connecting.h.secrets.values().values()];
  return Option.getOrThrow(keptTokensIn(Redacted.make(kept)));
}

async function loggedRemovalOf({ h, link }: Connecting): Promise<string> {
  await h.call(operationNamed(h.operations, 'remove_connection'), ada, { id: link.id });
  return h.logged().join('\n');
}

describe('the start of a consent through Auto’s consent service', () => {
  it('is unavailable where the service does not answer the start, in words that name no server it did not ask', async () => {
    const connecting = await throughAuto({ fetch: failingAt('/consents') });

    expect(await starting(connecting.h, connecting.link)).toMatchObject({
      reason: 'unavailable',
      detail:
        'The consent of the connection files cannot go on: a server it asks did not answer; try again in a moment',
    });
  });

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

  it('records the client the service redeemed with, which the handoff names, over the one the start recorded', async () => {
    const connecting = await throughAuto({ fetch: listingAnotherClient });

    const finished = await finishedWith(connecting.h, connecting.link, await returnedOf(connecting));
    const started = (await connecting.h.facts()).find(({ type }) => type === 'connection_consent_started');

    expect(started).toMatchObject({ data: { client_id: 'a-client-listed-before', client_source: 'auto' } });
    expect(finished).toMatchObject({ output: { credential: { client_id: 'auto-runtime', client_source: 'auto' } } });
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
              "Expected code: the consent of the connection files began with a client of this runtime's, which answers a code, not a handle",
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

  it('goes on where the service no longer knows its key or does not answer, saying so in words of the service', async () => {
    const [forgotten, gone] = await Promise.all([throughAuto(), throughAuto()]);
    const tokens = await connectedAt(forgotten);
    await connectedAt(gone);
    const connectionKey = String(tokens.connection_key);
    const { origin: issuer } = forgotten.serving.fake;
    await Effect.runPromise(serviceCallsAt(forgotten.serving.service).revoke({ issuer, tokens, connectionKey }));
    await gone.serving.service.close();

    expect([await loggedRemovalOf(forgotten), await loggedRemovalOf(gone)]).toEqual([
      expect.stringContaining(
        "Auto's consent service does not know the key of the connection files, so its tokens were not revoked and end on their own",
      ),
      expect.stringContaining(
        "Auto's consent service did not answer the revocation of the tokens of the connection files, so they end on their own",
      ),
    ]);
    expect([forgotten.h.secrets.values().size, gone.h.secrets.values().size]).toEqual([0, 0]);
  });
});

describe('a consent through a Studio neither Auto’s nor on this computer', () => {
  it('leaves Auto’s client out of the link and the start, which the source the way lists next serves, asking the service nothing', async () => {
    const serving = await servedThroughAuto({ dynamicRegistration: true });
    closing.push(serving.close);
    const h = consentHarnessAt(serving.fake, {
      way: { scope: 'files.read', clients: ['registered', 'dynamic'] },
      consenting: { autoClients: autoClientsOf(serving.service, 'elsewhere') },
    });
    const link = await added(h, { provider: 'files' });

    expect([await readingOf(h, link), await starting(h, link)]).toMatchObject([
      { output: { client_source: 'dynamic' } },
      { output: { client_source: 'dynamic' } },
    ]);
    expect(serving.service.calls()).toEqual([]);
  });

  it('leaves the source out of a link whose way no other source serves', async () => {
    const serving = await servedThroughAuto();
    closing.push(serving.close);
    const kinds: { now: ReturnKind } = { now: 'hosted' };
    const autoClients = { ...autoClientsOf(serving.service), returnKindOf: () => kinds.now };
    const h = consentHarnessAt(serving.fake, { consenting: { autoClients } });
    const link = await added(h, { provider: 'files' });
    kinds.now = 'elsewhere';

    const read = await readingOf(h, link);

    expect(read).toMatchObject({ status: 'succeeded', output: { name: 'files' } });
    expect(read).not.toHaveProperty('output.client_source');
  });
});
