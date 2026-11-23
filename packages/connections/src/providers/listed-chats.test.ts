import type { AccessDecision, CallerIdentity } from '@on.auto/operations';
import { decidingEach } from '@on.auto/operations/testing';
import {
  chatOverASocket,
  messages,
  providerListOf,
  providerOf,
  providersOf,
  trackerOverASocket,
} from '@on.auto/providers/testing';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { fakeChatModels, fakeChatModelsThroughAGateway, fakeSockets } from '../testing/harness-services.ts';
import { ada, harness, operationNamed, type Harness, type HarnessOptions } from '../testing/harness.ts';

const plan = ['auto/acme/fast', 'auto/acme/deep'];

const theDefault = 'auto/acme/fast';

const grace: CallerIdentity = { ...ada, id: 'person:grace', name: 'Grace Hopper', permissions: ['org:write'] };

const allowed: AccessDecision = { decision: 'allow', determiningPolicies: ['by-the-test'], errors: [] };

const denied: AccessDecision = { decision: 'deny', determiningPolicies: [], errors: [] };

const settingDeniedToGrace = decidingEach(({ context, principal }) =>
  Effect.succeed(context.operation.connectionsManagement && principal.id === 'grace' ? denied : allowed),
);

const chatServer: HarnessOptions = {
  providers: providersOf(chatOverASocket),
  sockets: fakeSockets({}),
  chatModels: fakeChatModels(plan),
};

const throughAGateway: HarnessOptions = {
  providers: providerListOf(providerOf(messages)),
  consenting: { gateways: true },
};

const ListedChatsSchema = Schema.Struct({
  output: Schema.Struct({
    providers: Schema.Array(
      Schema.Struct({ credentials: Schema.Array(Schema.Struct({ chat: Schema.optionalKey(Schema.Unknown) })) }),
    ),
  }),
});

async function chatsListedBy(h: Harness, caller = ada): Promise<readonly unknown[]> {
  const listed = Schema.decodeUnknownSync(ListedChatsSchema)(
    await h.call(operationNamed(h.operations, 'list_providers'), caller, {}),
  );
  return listed.output.providers.flatMap(({ credentials }) =>
    credentials.flatMap(({ chat }) => (chat === undefined ? [] : [chat])),
  );
}

describe('where members can write to Auto through a connection made a way, as list_providers says it', () => {
  it('names the credential that lets them, on a company’s own server, and whether this caller may choose the model', async () => {
    const h = harness({ ...chatServer, decidedBy: settingDeniedToGrace });

    expect(await chatsListedBy(h)).toEqual([{ credential: 'app_level_token', may_set_model: true }]);
    expect(await chatsListedBy(h, grace)).toEqual([{ credential: 'app_level_token', may_set_model: false }]);
  });

  it('names the model Auto answers with until one is chosen, on a way through a gateway where the host answers members through gateways', async () => {
    const h = harness({ ...throughAGateway, chatModels: fakeChatModelsThroughAGateway(plan, theDefault) });

    expect(await chatsListedBy(h)).toEqual([{ default_model: theDefault, may_set_model: true }]);
  });

  it.each([
    [
      'a server that composes no chat',
      () => harness({ providers: providersOf(chatOverASocket), sockets: fakeSockets({}) }),
    ],
    ['an entry that declares no chat', () => harness({ ...chatServer, providers: providersOf(trackerOverASocket) })],
    [
      'a way through a gateway where the host does not answer members through gateways',
      () => harness({ ...throughAGateway, chatModels: fakeChatModels(plan) }),
    ],
  ])('says nothing for %s', async (_case, made) => {
    expect(await chatsListedBy(made())).toEqual([]);
  });
});
