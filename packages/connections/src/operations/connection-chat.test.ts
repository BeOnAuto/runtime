import type { AccessDecision, CallerIdentity, Outcome } from '@on.auto/operations';
import { decidingEach } from '@on.auto/operations/testing';
import { chatOverASocket, providersOf, trackerOverASocket } from '@on.auto/providers/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { added, crm, reconnected } from '../testing/additions.ts';
import { fakeChatModels, fakeSockets } from '../testing/harness-services.ts';
import { ada, harness, operationNamed, type Harness, type HarnessOptions } from '../testing/harness.ts';

const fromTheTracker = { provider: 'tracker', placeholders: { site: 'acme' } };

const key = 'trk_0f3cAcme';

const appToken = 'xapp-1-A0001-0f3c';

const writingToAuto = { app_level_token: appToken } as const;

const chatServer: HarnessOptions = {
  providers: providersOf(chatOverASocket),
  sockets: fakeSockets({}),
  chatModels: fakeChatModels(['acme/fast', 'acme/deep']),
};

const theCloud: HarnessOptions = { providers: providersOf(chatOverASocket), sockets: fakeSockets({}) };

const grace: CallerIdentity = { ...ada, id: 'person:grace', name: 'Grace Hopper', permissions: ['org:write'] };

const allowed: AccessDecision = { decision: 'allow', determiningPolicies: ['by-the-test'], errors: [] };

const denied: AccessDecision = { decision: 'deny', determiningPolicies: [], errors: [] };

const operationsThatManageConnections = [
  'approve',
  'choose_way',
  'create_service_account',
  'decline_connection_request',
  'finish',
  'give_client',
  'give_credential',
  'read_link',
  'reconnect_connection',
  'remove_connection',
  'remove_connection_signing_secret',
  'set_connection_account_type',
  'set_connection_model',
  'set_connection_playbooks',
  'set_connection_signing_secret',
  'start',
  'test_connection',
];

const settingDeniedToGrace = decidingEach(({ action, principal }) =>
  Effect.succeed(action.name === 'set_connection_model' && principal.id === 'grace' ? denied : allowed),
);

function calling(h: Harness, operation: string, input: unknown, caller = ada): Promise<Outcome> {
  return h.call(operationNamed(h.operations, operation), caller, input);
}

async function connectedWith(h: Harness, given: Readonly<Record<string, unknown>>, caller = ada, name = 'tracker') {
  const { id, token } = await added(h, { ...fromTheTracker, name }, { caller });
  return { id, token, given: await calling(h, 'give_credential', { id, token, value: key, ...given }, caller) };
}

async function typesOf(h: Harness): Promise<readonly string[]> {
  return (await h.facts()).map(({ type }) => type);
}

const atTheModel = { status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/model' }] };

const addedAndLinked = ['connection_added', 'connection_link_issued'];

describe('the chat of a connection, as Studio reads it', () => {
  it('is answered on the page of its link before the credential that lets members write is held, with no model', async () => {
    const h = harness(chatServer);
    const { id, token } = await added(h, fromTheTracker);

    expect(await calling(h, 'read_link', { id, token })).toMatchObject({
      output: { chat: { credential: 'app_level_token', held: false, model: null, may_set_model: true } },
    });
  });

  it('is held once that credential is given, read alike by list and by id, and left out once the connection is removed', async () => {
    const h = harness(chatServer);
    const { id } = await connectedWith(h, { app_credentials: writingToAuto, model: 'acme/fast' });
    const chat = { credential: 'app_level_token', held: true, model: 'acme/fast', may_set_model: true };

    expect(await calling(h, 'list_connections', {})).toMatchObject({ output: { connections: [{ id, chat }] } });
    expect(await calling(h, 'get_connection', { id })).toMatchObject({ output: { id, chat } });
    await calling(h, 'remove_connection', { id });
    const removed = await calling(h, 'get_connection', { id });
    expect(removed).toMatchObject({ status: 'succeeded', output: { status: 'removed' } });
    expect(removed).not.toHaveProperty('output.chat');
  });
});

const unchatted: readonly (readonly [string, () => Harness])[] = [
  ['whose entry declares no chat', () => harness({ ...chatServer, providers: providersOf(trackerOverASocket) })],
  [
    'on a server that opens no sockets',
    () => harness({ providers: providersOf(chatOverASocket), chatModels: fakeChatModels(['acme/fast']) }),
  ],
];

describe('the chat of a connection, where it is left out', () => {
  it.each(unchatted)('is left out for a connection of a provider %s', async (_case, made) => {
    const h = made();
    const link = await added(h, fromTheTracker);

    const read = await calling(h, 'read_link', { id: link.id, token: link.token });

    expect(read).toMatchObject({ status: 'succeeded' });
    expect(read).not.toHaveProperty('output.chat');
  });

  it('is left out where members cannot write to Auto through the connection, and wherever the server answers no chat', async () => {
    const h = harness(chatServer);
    const { id, token } = await added(h, crm);
    const cloud = harness(theCloud);
    const offTheCloud = await added(cloud, fromTheTracker);
    const linkOffTheCloud = { id: offTheCloud.id, token: offTheCloud.token };

    expect(await calling(h, 'read_link', { id, token })).toMatchObject({ status: 'succeeded' });
    expect(await calling(h, 'read_link', { id, token })).not.toHaveProperty('output.chat');
    expect(await calling(cloud, 'read_link', linkOffTheCloud)).toMatchObject({ status: 'succeeded' });
    expect(await calling(cloud, 'read_link', linkOffTheCloud)).not.toHaveProperty('output.chat');
    expect(cloud.operations.map(({ registration }) => registration.name)).not.toContain('set_connection_model');
    const given = await calling(h, 'give_credential', { id, token, value: 'Bearer crm-0f3c' });
    expect(given).toMatchObject({ status: 'succeeded' });
    expect(given).not.toHaveProperty('output.chat');
    expect(await calling(h, 'set_connection_model', { id, model: 'acme/fast' })).toMatchObject({ reason: 'conflict' });
  });

  it('says whether this caller may choose the model, as the decision point decides', async () => {
    const h = harness({ ...chatServer, decidedBy: settingDeniedToGrace });
    const { id, token } = await added(h, fromTheTracker);
    const link = { id, token };

    expect(await calling(h, 'read_link', link, grace)).toMatchObject({ output: { chat: { may_set_model: false } } });
    expect(await calling(h, 'read_link', link)).toMatchObject({ output: { chat: { may_set_model: true } } });
  });
});

const unwaited: readonly (readonly [string, HarnessOptions, Readonly<Record<string, unknown>>, CallerIdentity])[] = [
  ['where the credential that lets members write is not given', chatServer, {}, ada],
  [
    'where the server lists no model to choose',
    { ...chatServer, chatModels: fakeChatModels([]) },
    { app_credentials: writingToAuto },
    ada,
  ],
  [
    'for a caller who may not choose the model',
    { ...chatServer, decidedBy: settingDeniedToGrace },
    { app_credentials: writingToAuto },
    grace,
  ],
];

describe('connecting where members can write to Auto, by give_credential', () => {
  it('waits for a model where the server lists one and none is saved, refusing at its field and keeping nothing', async () => {
    const h = harness(chatServer);

    const { given } = await connectedWith(h, { app_credentials: writingToAuto });

    expect(given).toMatchObject(atTheModel);
    expect(h.secrets.values().size).toBe(0);
    expect(await typesOf(h)).toEqual(addedAndLinked);
  });

  it.each(unwaited)('does not wait %s, recording no model', async (_case, options, given, caller) => {
    const h = harness(options);

    expect((await connectedWith(h, given, caller)).given).toMatchObject({
      status: 'succeeded',
      output: { status: 'connected', chat: { model: null } },
    });
    expect(await typesOf(h)).toEqual([...addedAndLinked, 'connection_approved', 'connection_connected']);
  });

  it('records the model given in the same record as the approval, and answers it', async () => {
    const h = harness(chatServer);

    const { given } = await connectedWith(h, { app_credentials: writingToAuto, model: 'acme/fast' });

    expect(given).toMatchObject({ status: 'succeeded', output: { status: 'connected', chat: { model: 'acme/fast' } } });
    expect(await typesOf(h)).toEqual([
      ...addedAndLinked,
      'connection_model_set',
      'connection_approved',
      'connection_connected',
    ]);
  });
});

describe('the model given at Connect, by give_credential', () => {
  it.each([
    ['a model the server does not offer', { app_credentials: writingToAuto, model: 'acme/gone' }],
    ['a model given without the credential that lets members write', { model: 'acme/fast' }],
  ] as const)('refuses %s at its field, keeping nothing', async (_case, given) => {
    const h = harness(chatServer);

    expect((await connectedWith(h, given)).given).toMatchObject(atTheModel);
    expect(h.secrets.values().size).toBe(0);
  });

  it('refuses a model from a caller who may not choose it', async () => {
    const h = harness({ ...chatServer, decidedBy: settingDeniedToGrace });

    const refused = await connectedWith(h, { app_credentials: writingToAuto, model: 'acme/fast' }, grace);

    expect(refused.given).toMatchObject({ status: 'rejected', reason: 'forbidden' });
  });
});

describe('connecting again, or where the server answers no chat, by give_credential', () => {
  it('keeps the saved model when connected again, records a model that changes it, and waits for none', async () => {
    const h = harness(chatServer);
    const { id } = await connectedWith(h, { app_credentials: writingToAuto, model: 'acme/fast' });
    const again = await reconnected(h, id);
    const giving = { id, token: again.token, value: key, app_credentials: writingToAuto };

    expect(await calling(h, 'give_credential', giving)).toMatchObject({ output: { chat: { model: 'acme/fast' } } });
    expect((await typesOf(h)).filter((type) => type === 'connection_model_set')).toHaveLength(1);
    const changed = await reconnected(h, id);
    expect(await calling(h, 'give_credential', { ...giving, token: changed.token, model: 'acme/deep' })).toMatchObject({
      output: { chat: { model: 'acme/deep' } },
    });
  });

  it('takes no model and waits for none on a server that answers no chat', async () => {
    const h = harness(theCloud);

    expect((await connectedWith(h, { app_credentials: writingToAuto, model: 'acme/fast' })).given).toMatchObject(
      atTheModel,
    );
    expect((await connectedWith(h, { app_credentials: writingToAuto }, ada, 'tracker-again')).given).toMatchObject({
      status: 'succeeded',
    });
    expect(await typesOf(h)).not.toContain('connection_model_set');
  });
});

describe('setting the model of a connection, by set_connection_model', () => {
  it('records the model and answers the connection with its chat, and records nothing for the model it has', async () => {
    const h = harness(chatServer);
    const { id } = await connectedWith(h, { app_credentials: writingToAuto, model: 'acme/fast' });

    expect(await calling(h, 'set_connection_model', { id, model: 'acme/deep' })).toMatchObject({
      status: 'succeeded',
      output: { id, chat: { held: true, model: 'acme/deep' } },
    });
    const recorded = (await h.facts()).length;
    expect(await calling(h, 'set_connection_model', { id, model: 'acme/deep' })).toMatchObject({
      status: 'succeeded',
    });
    expect((await h.facts()).length).toBe(recorded);
  });

  it('refuses a pending connection, a removed one and a model the server does not offer, recording nothing', async () => {
    const h = harness(chatServer);
    const pending = await added(h, { ...fromTheTracker, name: 'tracker-pending' });
    const { id } = await connectedWith(h, { app_credentials: writingToAuto, model: 'acme/fast' });
    const recorded = (await h.facts()).length;

    expect(await calling(h, 'set_connection_model', { id: pending.id, model: 'acme/deep' })).toMatchObject({
      reason: 'conflict',
    });
    expect(await calling(h, 'set_connection_model', { id, model: 'acme/gone' })).toMatchObject(atTheModel);
    expect((await h.facts()).length).toBe(recorded);
    await calling(h, 'remove_connection', { id });
    expect(await calling(h, 'set_connection_model', { id, model: 'acme/deep' })).toMatchObject({
      reason: 'conflict',
    });
  });

  it('is one of the operations of the connections that declare they manage them, every one that changes a connection or acts through its link, so the decision point keeps it to whom it decides', async () => {
    const h = harness({ ...chatServer, decidedBy: settingDeniedToGrace });
    const { id } = await connectedWith(h, { app_credentials: writingToAuto, model: 'acme/fast' });

    expect(
      h.operations
        .filter(({ registration }) => registration.connectionsManagement === true)
        .map(({ registration }) => registration.name)
        .toSorted(),
    ).toEqual(operationsThatManageConnections);
    expect(await calling(h, 'set_connection_model', { id, model: 'acme/deep' }, grace)).toMatchObject({
      reason: 'forbidden',
    });
  });
});
