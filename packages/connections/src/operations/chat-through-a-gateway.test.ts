import type { AccessDecision, CallerIdentity, Outcome } from '@on.auto/operations';
import { decidingEach } from '@on.auto/operations/testing';
import type { FakeGateway } from '@on.auto/tool-servers/served-fakes';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { modelsChosenIn } from '../registry/models-chosen.ts';
import { added } from '../testing/additions.ts';
import { connectedThrough, gatewayHarnessAt, gatewayServed, providersThrough } from '../testing/gateways.ts';
import { fakeChatModels, fakeChatModelsThroughAGateway } from '../testing/harness-services.ts';
import { ada, operationNamed, type Harness, type HarnessOptions } from '../testing/harness.ts';

const plan = ['auto/acme/fast', 'auto/acme/deep'];

const theDefault = 'auto/acme/fast';

const grace: CallerIdentity = { ...ada, id: 'person:grace', name: 'Grace Hopper', permissions: ['org:write'] };

const allowed: AccessDecision = { decision: 'allow', determiningPolicies: ['by-the-test'], errors: [] };

const denied: AccessDecision = { decision: 'deny', determiningPolicies: [], errors: [] };

const settingDeniedToGrace = decidingEach(({ context, principal }) =>
  Effect.succeed(context.operation.connectionsManagement && principal.id === 'grace' ? denied : allowed),
);

const atTheModel = { status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/model' }] };

const pendingOne = { provider: 'messages', name: 'messages-pending' };

function calling(h: Harness, operation: string, input: unknown, caller = ada): Promise<Outcome> {
  return h.call(operationNamed(h.operations, operation), caller, input);
}

function onAutosCloud(gateway: FakeGateway, options: HarnessOptions = {}): Harness {
  return gatewayHarnessAt(gateway, { chatModels: fakeChatModelsThroughAGateway(plan, theDefault), ...options });
}

describe('the chat of a connection made through its gateway, where the host answers members through gateways', () => {
  it('is answered with no credential and the model Auto answers with until one is chosen, held once it is connected', async () => {
    const gateway = gatewayServed();
    const h = onAutosCloud(gateway);
    const pending = await added(h, pendingOne);
    const { link } = await connectedThrough(h, gateway);
    const chat = { model: null, default_model: theDefault, may_set_model: true };

    const read = await calling(h, 'read_link', { id: pending.id, token: pending.token });

    expect(read).toMatchObject({ output: { chat: { ...chat, held: false } } });
    expect(read).not.toHaveProperty('output.chat.credential');
    expect(await calling(h, 'get_connection', { id: link.id })).toMatchObject({
      output: { chat: { ...chat, held: true } },
    });
  });

  it('takes a model the host offers once it is connected, from an admin alone, and refuses one while it is pending', async () => {
    const gateway = gatewayServed();
    const h = onAutosCloud(gateway, { decidedBy: settingDeniedToGrace });
    const pending = await added(h, pendingOne);
    const { link } = await connectedThrough(h, gateway);
    const { id } = link;

    expect(await calling(h, 'set_connection_model', { id, model: 'auto/acme/deep' })).toMatchObject({
      status: 'succeeded',
      output: { chat: { held: true, model: 'auto/acme/deep', default_model: theDefault } },
    });
    expect(await calling(h, 'set_connection_model', { id, model: 'auto/acme/gone' })).toMatchObject(atTheModel);
    expect(await calling(h, 'set_connection_model', { id, model: theDefault }, grace)).toMatchObject({
      reason: 'forbidden',
    });
    expect(await calling(h, 'set_connection_model', { id: pending.id, model: theDefault })).toMatchObject({
      reason: 'conflict',
    });
  });

  it('is left out where the host does not answer members through gateways', async () => {
    const gateway = gatewayServed();
    const h = gatewayHarnessAt(gateway, { chatModels: fakeChatModels(plan) });
    const { link } = await connectedThrough(h, gateway);

    const read = await calling(h, 'get_connection', { id: link.id });

    expect(read).toMatchObject({ status: 'succeeded', output: { status: 'connected' } });
    expect(read).not.toHaveProperty('output.chat');
  });
});

describe('the models chosen in an organization, as a host reads them for its members’ turns', () => {
  it('are each connected connection’s provider, account and saved model, in the order they were connected, and nothing of one with no model or not connected', async () => {
    const gateway = gatewayServed();
    const h = onAutosCloud(gateway);
    const first = await connectedThrough(h, gateway);
    const second = await connectedThrough(h, gateway, await added(h, { provider: 'messages', name: 'messages-2' }));
    await connectedThrough(h, gateway, await added(h, { provider: 'messages', name: 'messages-3' }));
    await added(h, pendingOne);
    await calling(h, 'set_connection_model', { id: first.link.id, model: 'auto/acme/deep' });
    await calling(h, 'set_connection_model', { id: second.link.id, model: theDefault });

    const chosen = await Effect.runPromise(
      modelsChosenIn({ registry: h.ledger.service, providers: providersThrough(gateway) }, 'acme'),
    );

    expect(chosen).toEqual([
      { provider: 'messages', account: 'A0001', model: 'auto/acme/deep' },
      { provider: 'messages', account: 'A0001', model: theDefault },
    ]);
  });
});
