import { sha256Of } from '@on.auto/operations';
import { serveFakeMcp } from '@on.auto/tool-servers/served-fakes';
import { Effect, Option, Redacted } from 'effect';
import { afterEach, describe, expect, it, onTestFinished } from 'vitest';

import { connectionFactsIn, secretIdOf, secretsKey, secretStoreInFile } from '../testing/records/kept-credentials.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { aSecretHeader, connectedWith } from '../testing/servers/connected-servers.ts';
import { connectionsAllowing, connectionsOnLoopback } from '../testing/servers/loopback-connections.ts';
import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const crmKey = 'crm-api-key-6e2b9d41';

const anotherKey = Buffer.alloc(32, 9);

const unreadableNow = `The credential of the connection crm cannot be read now: The secret is sealed under the key ${sha256Of(anotherKey).slice(0, 16)}, which is neither the current key nor the previous one`;

let ledger: TemporaryLedger | undefined;

afterEach(() => {
  ledger?.remove();
});

async function servedOn(
  fileName: string,
  environment: Readonly<Record<string, string>> = {},
): Promise<ReasoningServer> {
  const server = await servingReasoning([], {
    LEDGER_FILE: fileName,
    SECRETS_KEY: secretsKey.toString('base64'),
    ...connectionsOnLoopback,
    ...environment,
  });
  const stopping: { done?: Promise<void> } = {};
  const stop = (): Promise<void> => {
    stopping.done ??= server.stop();
    return stopping.done;
  };
  onTestFinished(stop);
  return { ...server, stop };
}

async function connectedBeforeARestart(): Promise<{ readonly fileName: string; readonly id: string }> {
  const crm = await serveFakeMcp({ bearer: crmKey });
  onTestFinished(crm.close);
  ledger = temporaryLedger();
  const first = await servedOn(ledger.fileName);
  await first.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  const id = await connectedWith(first, aSecretHeader('crm', crm.url), `Bearer ${crmKey}`);
  await first.stop();
  return { fileName: ledger.fileName, id };
}

const echoing = ['---', 'model: anthropic/claude-sonnet-4-5', 'tools: [crm/echo]', '---', 'Echo a note.'].join('\n');

async function ranEchoing(server: ReasoningServer) {
  await server.call('POST', `${alpha}/definitions/reasoning`, { body: { name: 'echo', source: echoing } });
  return server.call('POST', `${alpha}/definitions/reasoning/echo/run`, { body: { input: {} } });
}

function executed(server: ReasoningServer) {
  return server.call('POST', `${alpha}/tool-servers/crm/tools/echo/execute`, { body: { arguments: {} } });
}

async function sealedAgainUnder(fileName: string, id: string, key: Readonly<Uint8Array>, version: number) {
  const store = await secretStoreInFile(fileName, key);
  const secretId = Option.getOrThrow(Option.fromNullishOr(await secretIdOf(fileName, 'acme', id)));
  const replaced = await Effect.runPromise(store.replace(secretId, version, Redacted.make(`Bearer ${crmKey}`)));
  await store.close();
  return replaced;
}

describe('a connection whose credential the secret store of a restarted runtime cannot read now', () => {
  it('is refused unavailable in the words of the store and listed so, stays connected with nothing recorded, and is called once the credential can be read again', async () => {
    const { fileName, id } = await connectedBeforeARestart();
    await sealedAgainUnder(fileName, id, anotherKey, 1);
    const restarted = await servedOn(fileName);

    const refused = await executed(restarted);
    const ran = await ranEchoing(restarted);
    const searched = await restarted.call('GET', `${alpha}/tool-servers/search`);
    const read = await restarted.call('GET', `/v1/orgs/acme/connections/${id}`);
    const sealedAgain = await sealedAgainUnder(fileName, id, secretsKey, 2);
    const called = await executed(restarted);

    expect(refused).toMatchObject({
      status: 503,
      body: { kind: 'tool_not_offered', because: 'connection_unavailable', detail: unreadableNow },
    });
    expect(refused.headers.get('retry-after')).toBeNull();
    expect(ran).toMatchObject({
      status: 503,
      body: {
        reason: 'unavailable',
        kind: 'tool_not_offered',
        because: 'connection_unavailable',
        detail: unreadableNow,
      },
    });
    expect(searched.body).toMatchObject({
      servers: [{ name: 'crm', connection: id, because: 'connection_unavailable', unavailable: unreadableNow }],
    });
    expect(read.body).toMatchObject({ status: 'connected' });
    expect(sealedAgain).toEqual({ replaced: true, version: 3 });
    expect(called.status).toBe(200);
    expect(await connectionFactsIn(fileName, 'acme')).not.toContain('connection_broken');
  });
});

describe('a connection the rules of a restarted runtime no longer allow', () => {
  it('is refused in the sentence of the rule, as adding it would be, and listed unavailable in it', async () => {
    const { fileName } = await connectedBeforeARestart();
    const restarted = await servedOn(fileName, connectionsAllowing(['127.0.0.1'], { credential_kinds: ['none'] }));
    const rule = 'A connection may not take a secret credential on this runtime, which allows none';

    const refused = await executed(restarted);
    const searched = await restarted.call('GET', `${alpha}/tool-servers/search`);

    expect(refused).toMatchObject({
      status: 503,
      body: { kind: 'tool_not_offered', because: 'connection_not_allowed', detail: rule },
    });
    expect(searched.body).toMatchObject({
      servers: [{ name: 'crm', because: 'connection_not_allowed', unavailable: rule }],
    });
  });
});
