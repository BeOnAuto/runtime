import { randomUUID } from 'node:crypto';

import { serveFakeKms } from '@on.auto/secrets/testing';
import { serveFakeMcp } from '@on.auto/tool-servers/testing';
import { afterAll, describe, expect, it, onTestFinished, vi } from 'vitest';

import { aSecretHeader, connectedWith } from '../testing/servers/connected-servers.ts';
import {
  alpha,
  servingReasoning,
  type ReasoningServer,
  connectionsReachingTheLoopback,
} from '../testing/servers/reasoning-server.ts';

const keyId = randomUUID();

const keyArn = `arn:aws:kms:eu-west-1:111122223333:key/${keyId}`;

const fake = await serveFakeKms({ keys: [keyArn] });

afterAll(fake.close);

const crmKey = 'crm-api-key-5d1c7e20';

function kmsOfTheEnvironmentAtTheFake(): void {
  vi.stubEnv('AWS_ENDPOINT_URL_KMS', fake.url);
  vi.stubEnv('AWS_ACCESS_KEY_ID', 'an-access-key-of-the-tests');
  vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'a-secret-access-key-of-the-tests');
  onTestFinished(() => {
    vi.unstubAllEnvs();
  });
}

async function servedUnderTheKeyInKms(): Promise<ReasoningServer> {
  kmsOfTheEnvironmentAtTheFake();
  const server = await servingReasoning([], { SECRETS_KEY_KMS: keyArn, CONNECTIONS: connectionsReachingTheLoopback() });
  onTestFinished(server.stop);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  return server;
}

function executed(server: ReasoningServer) {
  return server.call('POST', `${alpha}/tool-servers/crm/tools/echo/execute`, { body: { arguments: {} } });
}

describe('a connection whose credential is sealed under a key in KMS that is disabled meanwhile', () => {
  it('fails its call as connection_unavailable in the words of KMS, stays connected, and is called once the key is enabled again', async () => {
    const crm = await serveFakeMcp({ bearer: crmKey });
    onTestFinished(crm.close);
    const server = await servedUnderTheKeyInKms();
    const id = await connectedWith(server, aSecretHeader('crm', crm.url), `Bearer ${crmKey}`);

    fake.tell(keyArn, 'disabled');
    onTestFinished(() => {
      fake.tell(keyArn, 'enabled');
    });
    const refused = await executed(server);
    const read = await server.call('GET', `/v1/orgs/acme/connections/${id}`);
    fake.tell(keyArn, 'enabled');
    const called = await executed(server);

    expect(refused).toMatchObject({
      status: 503,
      body: {
        kind: 'tool_not_offered',
        because: 'connection_unavailable',
        detail: `The credential of the connection crm cannot be read now: The custodian of the key ${keyId} refused to unwrap a data key: DisabledException: key/${keyId} is disabled.`,
      },
    });
    expect(read.body).toMatchObject({ status: 'connected' });
    expect(called.status).toBe(200);
    expect(new Set(fake.calls().map(({ keyId: asked, context }) => `${asked} ${JSON.stringify(context)}`))).toEqual(
      new Set([`${keyArn} {"on.auto/runtime":"secret data key"}`]),
    );
  });
});
