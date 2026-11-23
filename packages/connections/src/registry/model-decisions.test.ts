import { providerListOf } from '@on.auto/providers/testing';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ChatOffered, ConnectionCommand } from './connection-commands.ts';
import type { RecordedConnectionEvent } from './connection-events.ts';
import { registryDeciderOf } from './registry-decider.ts';

const acted = { by: 'person:ada', at: '2026-10-15T14:00:00.000Z' };

const connection = 'connection-1';

const ada = { id: 'person:ada', name: 'Ada Lovelace' } as const;

const chat: ChatOffered = { through: 'app_credential', credential: 'app_level_token' };

const throughItsGateway: ChatOffered = { through: 'gateway' };

const added: RecordedConnectionEvent = {
  type: 'connection_added',
  data: {
    connection,
    name: 'chat',
    server_type: 'mcp',
    provider: null,
    placeholders: null,
    entry: { url: 'https://chat.example.com/mcp' },
    credential: { kind: 'secret', name: 'Authorization', in: 'header' },
    says: {},
    added_by: ada,
  },
  context: acted,
};

const linked: RecordedConnectionEvent = {
  type: 'connection_link_issued',
  data: { connection, token_sha256: 'a1b2' },
  context: acted,
};

const holding = (appSecretIds: Readonly<Record<string, string>>): RecordedConnectionEvent => ({
  type: 'connection_connected',
  data: { connection, secret_id: 'secret-1', app_secret_ids: appSecretIds, connected_by: ada },
  context: acted,
});

const holdingTheToken = holding({ app_level_token: 'secret-2' });

const modelSet = (model: string): RecordedConnectionEvent => ({
  type: 'connection_model_set',
  data: { connection, model },
  context: acted,
});

const removed: RecordedConnectionEvent = { type: 'connection_removed', data: { connection }, context: acted };

function decided(facts: readonly RecordedConnectionEvent[], command: ConnectionCommand): unknown {
  const decider = registryDeciderOf(providerListOf());
  const registry = facts.reduce((state, fact) => decider.evolve(state, fact), decider.initialState);
  const decision = decider.decide(command, registry);
  return Result.isSuccess(decision)
    ? decision.success.map(({ type, data }) => (type === 'connection_model_set' ? `${type} ${data.model}` : type))
    : decision.failure;
}

const anyWords: unknown = expect.any(String);

const atTheModel = { _tag: 'invalid_input', issues: [{ pointer: '/model', detail: anyWords }] } as const;

const settingTheModel = { type: 'set_model', connection, chat, ...acted } as const;

const fast = { model: 'acme/fast' } as const;

const settings = [
  {
    name: 'records the model it changes to',
    facts: [added, holdingTheToken],
    command: { ...settingTheModel, model: fast },
    outcome: ['connection_model_set acme/fast'],
  },
  {
    name: 'records nothing for the model it has',
    facts: [added, holdingTheToken, modelSet('acme/fast')],
    command: { ...settingTheModel, model: fast },
    outcome: [],
  },
  {
    name: 'refuses a connection it does not hold',
    facts: [],
    command: { ...settingTheModel, model: fast },
    outcome: { _tag: 'not_found' },
  },
  {
    name: 'refuses a removed connection',
    facts: [added, holdingTheToken, removed],
    command: { ...settingTheModel, model: fast },
    outcome: { _tag: 'conflict' },
  },
  {
    name: 'refuses a pending connection, which holds no credential yet',
    facts: [added],
    command: { ...settingTheModel, model: fast },
    outcome: { _tag: 'conflict' },
  },
  {
    name: 'refuses a connection that does not hold the credential that lets members write to Auto',
    facts: [added, holding({})],
    command: { ...settingTheModel, model: fast },
    outcome: { _tag: 'conflict' },
  },
  {
    name: 'refuses a connection through which no member can write to Auto here',
    facts: [added, holdingTheToken],
    command: { type: 'set_model', connection, model: fast, ...acted },
    outcome: { _tag: 'conflict' },
  },
  {
    name: 'refuses a model the server does not offer, at its field',
    facts: [added, holdingTheToken],
    command: { ...settingTheModel, model: { model: 'acme/gone', notOffered: 'Not offered' } },
    outcome: atTheModel,
  },
  {
    name: 'records the model of a connection whose chat goes through its gateway once it is connected',
    facts: [added, holding({})],
    command: { ...settingTheModel, chat: throughItsGateway, model: fast },
    outcome: ['connection_model_set acme/fast'],
  },
  {
    name: 'refuses a connection whose chat goes through its gateway while it is pending',
    facts: [added],
    command: { ...settingTheModel, chat: throughItsGateway, model: fast },
    outcome: { _tag: 'conflict' },
  },
] as const;

describe('setting the model of a connection', () => {
  it.each(settings)('$name', ({ facts, command, outcome }) => {
    expect(decided(facts, command)).toMatchObject(outcome);
  });
});

const givingWithoutAChat = {
  type: 'give',
  connection,
  token_sha256: 'a1b2',
  bindsPerson: false,
  connected_by: ada,
  secret_id: 'secret-1',
  app_secret_ids: { app_level_token: 'secret-2' },
  ...acted,
} as const;

const giving = { ...givingWithoutAChat, chat } as const;

const connected = ['connection_approved', 'connection_connected'] as const;

const connectings = [
  {
    name: 'records the model given in the same record as the approval',
    facts: [added, linked],
    command: { ...giving, model: fast },
    outcome: ['connection_model_set acme/fast', ...connected],
  },
  {
    name: 'records no model where none is given',
    facts: [added, linked],
    command: giving,
    outcome: connected,
  },
  {
    name: 'records nothing more for the saved model given again',
    facts: [added, linked, modelSet('acme/fast')],
    command: { ...giving, model: fast },
    outcome: connected,
  },
  {
    name: 'records a model that changes the saved one',
    facts: [added, linked, modelSet('acme/fast')],
    command: { ...giving, model: { model: 'acme/deep' } },
    outcome: ['connection_model_set acme/deep', ...connected],
  },
  {
    name: 'refuses a model given without the credential that lets members write',
    facts: [added, linked],
    command: { ...giving, app_secret_ids: {}, model: fast },
    outcome: atTheModel,
  },
  {
    name: 'refuses a model given where no member can write to Auto here',
    facts: [added, linked],
    command: { ...givingWithoutAChat, model: fast },
    outcome: atTheModel,
  },
  {
    name: 'refuses a model the server does not offer, at its field',
    facts: [added, linked],
    command: { ...giving, model: { model: 'acme/gone', notOffered: 'Not offered' } },
    outcome: atTheModel,
  },
  {
    name: 'refuses a model given for a chat that goes through the connection’s gateway, which no credential given here opens',
    facts: [added, linked],
    command: { ...givingWithoutAChat, chat: throughItsGateway, model: fast },
    outcome: atTheModel,
  },
] as const;

describe('connecting a connection through which members can write to Auto', () => {
  it.each(connectings)('$name', ({ facts, command, outcome }) => {
    expect(decided(facts, command)).toMatchObject(outcome);
  });
});
