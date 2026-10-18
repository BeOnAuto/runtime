import { Conflict } from '@on.auto/operations';
import type { ConnectionSource, ConnectionUnready, OrgConnection } from '@on.auto/tool-servers';
import { Effect, Logger, Option, type Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { connectionPolicyOf, type ConnectionPolicyFields } from '../policy/connection-policy.ts';
import { added, crm, notes } from '../testing/additions.ts';
import { ada, harness, operationNamed, type Harness, fixtureServing } from '../testing/harness.ts';
import { makeConnectionSource } from './connection-source.ts';
import type { ServingServices } from './given-credentials.ts';

const sealedElsewhere = 'The secret is sealed under the key k2, which is neither the current key nor the previous one';

function sourceOf(h: Harness, changes: Partial<ServingServices> = {}): ConnectionSource {
  return makeConnectionSource({
    registry: h.ledger.service,
    secrets: h.secrets,
    policy: connectionPolicyOf({}),
    variables: new Map(),
    modelProviders: ['openai'],
    ...fixtureServing,
    ...changes,
  });
}

function policyOf(fields: ConnectionPolicyFields) {
  return { policy: connectionPolicyOf(fields) };
}

async function connectedCrm(h: Harness): Promise<string> {
  const { id, token } = await added(h, crm);
  await h.call(operationNamed(h.operations, 'give_credential'), ada, { id, token, value: 'Bearer crm-key-0f3c9a71' });
  return id;
}

async function connectionOf(source: ConnectionSource, id: string): Promise<OrgConnection> {
  return Option.getOrThrow(
    Option.fromNullishOr((await Effect.runPromise(source.connectionsOf('acme'))).find((each) => each.id === id)),
  );
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

function unreadableIn(h: Harness) {
  return { ...h.secrets, read: () => Effect.fail({ detail: sealedElsewhere }) };
}

function unreadableCounted(h: Harness) {
  const reads = { made: 0 };
  const secrets = {
    ...h.secrets,
    read: () =>
      Effect.suspend(() => {
        reads.made += 1;
        return Effect.fail({ detail: sealedElsewhere });
      }),
  };
  return { reads, secrets };
}

const brokenReason = `The credential of the connection crm cannot be read, so the person who added it removes it and adds it again: ${sealedElsewhere}`;

describe('a connection whose credential the secret store cannot read', () => {
  it('is broken by the runtime with the sentence of why, and answered broken from then on', async () => {
    const h = harness();
    const id = await connectedCrm(h);

    const refused = await refusalOf(sourceOf(h, { secrets: unreadableIn(h) }), id);

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

  it('is broken when the secret store no longer holds its credential', async () => {
    const h = harness();
    const id = await connectedCrm(h);
    await Effect.runPromise(h.secrets.forget('secret-1'));

    expect(await refusalOf(sourceOf(h), id)).toEqual({
      because: 'connection_broken',
      detail:
        'The credential of the connection crm is no longer in the secret store, so the person who added it removes it and adds it again',
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

    const refused = await refusalOf(sourceOf(h, { secrets: unreadableIn(h), registry: unrecorded }), id, logging);

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
    const { reads, secrets } = unreadableCounted(h);
    const { lines, logging } = loggedLines();
    const source = sourceOf(h, { secrets, registry: changed });

    const refused = [await refusalOf(source, id, logging), await refusalOf(source, id, logging)];

    expect(refused.map(({ because }) => because)).toEqual(['connection_broken', 'connection_broken']);
    expect([reads.made, lines.length]).toEqual([2, 2]);
  });

  it('logs nothing when the connection was removed meanwhile', async () => {
    const h = harness();
    const id = await connectedCrm(h);
    const listed = await connectionOf(sourceOf(h, { secrets: unreadableIn(h) }), id);
    await h.call(operationNamed(h.operations, 'remove_connection'), ada, { id });
    const { lines, logging } = loggedLines();

    const refused = await refusalIn(listed, logging);

    expect([refused.because, lines]).toEqual(['connection_broken', []]);
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
