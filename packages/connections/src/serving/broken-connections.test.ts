import { Conflict } from '@on.auto/operations';
import type { ConnectionSource, ConnectionUnready, OrgConnection } from '@on.auto/tool-servers';
import { Effect, Logger, Redacted, type Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { connectionPolicyOf, type ConnectionPolicyFields } from '../policy/connection-policy.ts';
import { added, billing, notes, reconnected } from '../testing/additions.ts';
import { connectedCrm } from '../testing/crm-connections.ts';
import { ada, harness, operationNamed, type Harness } from '../testing/harness.ts';
import { preparedOf, servedAs as connectionOf, sourceOver as sourceOf } from '../testing/served-connections.ts';

function policyOf(fields: ConnectionPolicyFields) {
  return { policy: connectionPolicyOf(fields) };
}

function refusalIn(
  { state }: OrgConnection,
  logging: Layer.Layer<never> = Logger.layer([]),
): Promise<ConnectionUnready> {
  return state.status === 'connected'
    ? Effect.runPromise(Effect.provide(Effect.flip(state.server), logging))
    : Promise.resolve(state.unready);
}

async function refusalOf(
  source: ConnectionSource,
  id: string,
  logging?: Layer.Layer<never>,
): Promise<ConnectionUnready> {
  return refusalIn(await connectionOf(source, id), logging);
}

function loggedLines() {
  const lines: string[] = [];
  const logging = Logger.layer([
    Logger.map(Logger.formatJson, (line: string) => {
      lines.push(line);
    }),
  ]);
  return { lines, logging };
}

function goneFrom(h: Harness) {
  return { ...h.secrets, read: () => Effect.undefined };
}

function goneCounted(h: Harness) {
  const reads = { made: 0 };
  const secrets = {
    ...h.secrets,
    read: () =>
      Effect.suspend(() => {
        reads.made += 1;
        return Effect.undefined;
      }),
  };
  return { reads, secrets };
}

const brokenReason =
  'The credential of the connection crm is no longer in the secret store, so the person who added it reconnects it';

describe('a connection whose credential the secret store no longer holds', () => {
  it('is broken by the runtime with the sentence of why, and answered broken from then on', async () => {
    const h = harness();
    const id = await connectedCrm(h);
    await Effect.runPromise(h.secrets.forget('secret-1'));

    const refused = await refusalOf(sourceOf(h), id);

    expect(refused).toEqual({ because: 'connection_broken', detail: brokenReason });
    expect((await h.facts()).at(-1)).toMatchObject({
      type: 'connection_broken',
      data: { connection: id, reason: brokenReason },
      context: { by: 'runtime' },
    });
    expect((await connectionOf(sourceOf(h), id)).state).toEqual({
      status: 'unready',
      unready: { because: 'connection_broken', detail: brokenReason },
    });
  });
});

describe('a connection the rules of the moment no longer allow', () => {
  it('is refused with the sentence of the rule, the one adding it would get, and its credential is not read', async () => {
    const h = harness();
    const id = await connectedCrm(h);
    const unread = { ...h.secrets, read: () => Effect.die(new Error('The credential was read')) };

    const refusals = [
      await refusalOf(sourceOf(h, { ...policyOf({ credential_kinds: ['none'] }), secrets: unread }), id),
      await refusalOf(sourceOf(h, { ...policyOf({ people_may_add: false }), secrets: unread }), id),
      await refusalOf(sourceOf(h, { ...policyOf({ allowed_hosts: ['notes.example.com'] }), secrets: unread }), id),
    ];

    expect(refusals).toEqual([
      {
        because: 'connection_not_allowed',
        detail: 'A connection may not take a secret credential on this runtime, which allows none',
      },
      {
        because: 'connection_not_allowed',
        detail: 'This runtime uses no connection: its operator sets up its tool servers itself',
      },
      {
        because: 'connection_not_allowed',
        detail: 'A connection may not reach the host crm.example.com on this runtime, which allows notes.example.com',
      },
    ]);
  });

  it('is refused when its entry is no longer one the runtime takes, as when a provider took its name since', async () => {
    const h = harness();
    const { id, token } = await added(h, { ...notes, name: 'mistral' });
    await h.call(operationNamed(h.operations, 'approve'), ada, { id, token });

    expect(await refusalOf(sourceOf(h, { modelProviders: ['openai', 'mistral'] }), id)).toEqual({
      because: 'connection_not_allowed',
      detail:
        'The entry of the connection mistral is not one this runtime takes any more: The name of a model provider or gateway, which a reasoning function could not tell apart from it',
    });
  });
});

describe('a connection the runtime cannot record broken', () => {
  it('is refused broken all the same, and the runtime logs that it could not record it', async () => {
    const h = harness();
    const id = await connectedCrm(h);
    const unrecorded = { ...h.ledger.service, execute: () => Effect.die(new Error('The ledger is not reachable')) };
    const { lines, logging } = loggedLines();

    const refused = await refusalOf(sourceOf(h, { secrets: goneFrom(h), registry: unrecorded }), id, logging);

    expect(refused).toEqual({ because: 'connection_broken', detail: brokenReason });
    expect(lines).toEqual([expect.stringContaining('could not record it broken')]);
    expect((await connectionOf(sourceOf(h), id)).state.status).toBe('connected');
  });
});

describe('a break the registry does not take', () => {
  it('logs a change of the registry that came first, and reads the credential again at the next use', async () => {
    const h = harness();
    const id = await connectedCrm(h);
    const concurrent = new Conflict({ detail: 'The registry changed meanwhile', kind: 'concurrent_change' });
    const changed = { ...h.ledger.service, execute: () => Effect.fail(concurrent) };
    const { reads, secrets } = goneCounted(h);
    const { lines, logging } = loggedLines();
    const source = sourceOf(h, { secrets, registry: changed });

    const refused = [await refusalOf(source, id, logging), await refusalOf(source, id, logging)];

    expect(refused.map(({ because }) => because)).toEqual(['connection_broken', 'connection_broken']);
    expect([reads.made, lines.length]).toEqual([2, 2]);
  });

  it('logs nothing when the connection was removed meanwhile', async () => {
    const h = harness();
    const id = await connectedCrm(h);
    const listed = await connectionOf(sourceOf(h, { secrets: goneFrom(h) }), id);
    await h.call(operationNamed(h.operations, 'remove_connection'), ada, { id });
    const { lines, logging } = loggedLines();

    const refused = await refusalIn(listed, logging);

    expect([refused.because, lines]).toEqual(['connection_broken', []]);
  });
});

const keyRefused =
  'The tool server answered HTTP 401: it refused the credential the connection holds, so the person who added it reconnects it';

const fiveMinutesLater = '2026-10-15T14:05:00.000Z';

async function breaksOf(h: Harness) {
  return (await h.facts()).filter(({ type }) => type === 'connection_broken');
}

describe('a connection whose server refuses the credential it holds', () => {
  it('is broken by the runtime in words that say to reconnect it, once, and answered broken from then on', async () => {
    const h = harness();
    const id = await connectedCrm(h);
    const server = await preparedOf(sourceOf(h), id);

    const answered = [await Effect.runPromise(server.refused), await Effect.runPromise(server.refused)];

    expect(answered).toEqual([keyRefused, keyRefused]);
    expect(await breaksOf(h)).toMatchObject([
      { data: { connection: id, reason: keyRefused }, context: { by: 'runtime' } },
    ]);
    expect((await connectionOf(sourceOf(h), id)).state).toEqual({
      status: 'unready',
      unready: { because: 'connection_broken', detail: keyRefused },
    });
  });

  it('is left connected where the refusal came from a use made before the person connected it again', async () => {
    const h = harness();
    const id = await connectedCrm(h);
    const before = await preparedOf(sourceOf(h), id);
    const { token } = await reconnected(h, id, fiveMinutesLater);
    await h.call(
      operationNamed(h.operations, 'give_credential'),
      ada,
      { id, token, value: 'Bearer crm-key-7d2e4b19' },
      fiveMinutesLater,
    );

    await Effect.runPromise(before.refused);

    expect(await breaksOf(h)).toEqual([]);
    expect((await connectionOf(sourceOf(h), id)).state.status).toBe('connected');
  });
});

describe('a connection of client credentials whose server refuses them', () => {
  it('is broken in the words of a refused credential, which say to reconnect it', async () => {
    const h = harness();
    const { id, token } = await added(h, billing);
    await h.call(operationNamed(h.operations, 'give_credential'), ada, {
      id,
      token,
      client_secret: 'billing-secret-4e1a',
    });

    expect(await Effect.runPromise((await preparedOf(sourceOf(h), id)).refused)).toBe(keyRefused);
  });
});

describe('a connection whose server asks for a credential it does not hold', () => {
  it('is broken in words that say to remove it and add it again with one', async () => {
    const h = harness();
    const { id, token } = await added(h, notes);
    await h.call(operationNamed(h.operations, 'approve'), ada, { id, token });

    await Effect.runPromise((await preparedOf(sourceOf(h), id)).refused);

    expect(await breaksOf(h)).toMatchObject([
      {
        data: {
          reason:
            'The tool server answered HTTP 401: it asks for a credential the connection does not hold, so the person who added it removes it and adds it again with one',
        },
      },
    ]);
  });
});

describe('a connection of a reference whose server refuses the value of its variable', () => {
  it('is broken in words that name the variable, for whoever runs the runtime to set right and the person to reconnect', async () => {
    const listing = policyOf({ variables: ['NOTES_API_KEY'] });
    const h = harness(listing);
    const credential = { kind: 'reference', variable: 'NOTES_API_KEY', name: 'X-Api-Key', in: 'header' };
    const { id, token } = await added(h, { ...notes, credential });
    await h.call(operationNamed(h.operations, 'approve'), ada, { id, token });
    const variables = new Map([['NOTES_API_KEY', Redacted.make('notes-key-5b2e9d')]]);

    await Effect.runPromise((await preparedOf(sourceOf(h, { ...listing, variables }), id)).refused);

    expect(await breaksOf(h)).toMatchObject([
      {
        data: {
          reason:
            'The tool server answered HTTP 401: it refused the value of the variable NOTES_API_KEY, so whoever runs the runtime sets it right and starts it again, and the person who added the connection reconnects it',
        },
      },
    ]);
  });
});

describe('a connection approved with no credential to give', () => {
  it('is served with none', async () => {
    const h = harness();
    const { id, token } = await added(h, notes);
    await h.call(operationNamed(h.operations, 'approve'), ada, { id, token });

    const { state } = await connectionOf(sourceOf(h), id);

    expect(state.status).toBe('connected');
  });
});
