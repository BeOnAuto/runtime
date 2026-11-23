import { defaultOrg } from '@on.auto/openid-connect';
import { Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { personSigningIn } from '../sign-in/person-signing-in.ts';
import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

let server: ReasoningServer | undefined;

afterEach(async () => {
  await server?.stop();
});

async function signedInServer() {
  const signing = await personSigningIn();
  const served = await servingReasoning([], signing.environment);
  server = served;
  return { served, tokenOf: (who: string) => signing.tokenAt(served.origin, who) };
}

const ChatsListedSchema = Schema.Struct({
  providers: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      credentials: Schema.Array(Schema.Struct({ chat: Schema.optionalKey(Schema.Unknown) })),
    }),
  ),
});

const AddedIdSchema = Schema.Struct({ id: Schema.String });

interface Keyed {
  readonly key?: string;
}

async function chatsListedBy(served: ReasoningServer, org: string, keyed: Keyed) {
  const { body } = await served.call('GET', `/v1/orgs/${org}/providers`, keyed);
  return Schema.decodeUnknownSync(ChatsListedSchema)(body).providers.flatMap(({ name, credentials }) =>
    credentials.flatMap(({ chat }) => (chat === undefined ? [] : [[name, chat]])),
  );
}

async function slackBotConnectionOf(served: ReasoningServer, org: string, keyed: Keyed) {
  const added = await served.call('POST', `/v1/orgs/${org}/connections`, { ...keyed, body: { provider: 'slack-bot' } });
  const { id } = Schema.decodeUnknownSync(AddedIdSchema)(added.body);
  return {
    answered: await served.call('GET', `/v1/orgs/${org}/connections/${id}`, keyed),
    modelSet: await served.call('PUT', `/v1/orgs/${org}/connections/${id}/model`, {
      ...keyed,
      body: { model: 'anthropic/claude-sonnet-4-5' },
    }),
  };
}

describe('the chat, members writing to Auto through a connection, on a runtime that signs nobody in', () => {
  it('is offered on no way a provider is listed with and by no connection, and no model of a connection is served, since no member can write to Auto there', async () => {
    server = await servingReasoning([]);

    const { answered, modelSet } = await slackBotConnectionOf(server, 'local', {});

    expect(await chatsListedBy(server, 'local', {})).toEqual([]);
    expect(answered).toMatchObject({ status: 200, body: { provider: 'slack-bot' } });
    expect(answered.body).not.toHaveProperty('chat');
    expect(modelSet).toMatchObject({ status: 404 });
  });
});

describe('the chat, members writing to Auto through a connection, on a runtime that signs people in', () => {
  it('is offered on the way of a provider whose entry declares it and by a connection made that way, whose model an admin may set', async () => {
    const { served, tokenOf } = await signedInServer();
    const ada = await tokenOf('Ada');

    const { answered } = await slackBotConnectionOf(served, defaultOrg, { key: ada });

    expect(await chatsListedBy(served, defaultOrg, { key: ada })).toContainEqual([
      'slack-bot',
      { credential: 'app_level_token', may_set_model: true },
    ]);
    expect(answered).toMatchObject({
      status: 200,
      body: { chat: { credential: 'app_level_token', held: false, model: null, may_set_model: true } },
    });
  });
});
