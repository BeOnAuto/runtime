import { signingKeyOf, webhookSignatureOf } from '@on.auto/identity';
import { serveFakeMcp, type FakeMcpServer } from '@on.auto/tool-servers/served-fakes';
import { Schema } from 'effect';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { secretsKey } from '../testing/records/kept-credentials.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { connectionsOnLoopback } from '../testing/servers/loopback-connections.ts';
import { servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const connections = '/v1/orgs/local/connections';

const runId = '019a4131-9d2e-7f40-8a51-6b7c8d9e0f12';

const otherRun = '019a4131-9d2e-7f40-8a51-6b7c8d9e0f13';

const body = JSON.stringify({ answer: { verdict: 'approve' } });

const otherSecret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';

let approvalsServer: FakeMcpServer;

beforeAll(async () => {
  approvalsServer = await serveFakeMcp({});
});

afterAll(async () => {
  await approvalsServer.close();
});

const servers: ReasoningServer[] = [];

let ledger: TemporaryLedger | undefined;

afterEach(async () => {
  await Promise.all(servers.splice(0).map((served) => served.stop()));
  ledger?.remove();
});

async function serving(environment: Readonly<Record<string, string>> = {}): Promise<ReasoningServer> {
  ledger ??= temporaryLedger();
  const served = await servingReasoning(
    [],
    { SECRETS_KEY: secretsKey.toString('base64'), ...connectionsOnLoopback, ...environment },
    undefined,
    {
      ledger,
    },
  );
  servers.push(served);
  return served;
}

const AddedSchema = Schema.Struct({ id: Schema.String });

const MadeSchema = Schema.Struct({ secret: Schema.String });

async function receiving(served: ReasoningServer): Promise<string> {
  const added = await served.call('POST', connections, {
    body: { name: 'approvals', type: 'mcp', entry: { url: approvalsServer.url }, credential: { kind: 'none' } },
  });
  const { id } = Schema.decodeUnknownSync(AddedSchema)(added.body);
  const set = await served.call('POST', `${connections}/${id}/signing-secret`, { body: {} });
  return Schema.decodeUnknownSync(MadeSchema)(set.body).secret;
}

interface Delivering {
  readonly run?: string;
  readonly id?: string;
  readonly name?: string;
}

function delivered(served: ReasoningServer, secret: string, delivering: Delivering = {}) {
  const { run = runId, id = 'msg_2Lh9KRb1t3', name = 'approvals' } = delivering;
  const key = signingKeyOf(secret);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature =
    key === undefined ? 'v1,none' : webhookSignatureOf(key, id, timestamp, new TextEncoder().encode(body));
  return fetch(`${served.origin}/v1/orgs/local/playbooks/alpha/connections/${name}/runs/${run}/answer`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'webhook-id': id,
      'webhook-timestamp': String(timestamp),
      'webhook-signature': signature,
    },
    body,
  });
}

describe('a delivery to an answer address of the server', () => {
  it('is verified with the secret its connection holds, needing no key, and refused 401 with any other', async () => {
    const served = await serving();
    const secret = await receiving(served);

    const [signed, wrong] = [
      await delivered(served, secret),
      await delivered(served, otherSecret, { id: 'msg_wrong' }),
    ];

    expect(signed.status).toBe(404);
    expect(await signed.json()).toMatchObject({
      detail: 'There is no request of this playbook that this connection was asked at this address',
    });
    expect(wrong.status).toBe(401);
  });

  it('is refused 401 alike at the address of a connection the org does not hold', async () => {
    const served = await serving();
    const secret = await receiving(served);

    const elsewhere = await delivered(served, secret, { id: 'msg_elsewhere', name: 'mail' });

    expect(elsewhere.status).toBe(401);
  });

  it('keeps the id it took across a restart, so the same delivery at another request is refused', async () => {
    const first = await serving();
    const secret = await receiving(first);
    await delivered(first, secret);
    await first.stop();
    servers.splice(0);

    const second = await serving();
    const [again, elsewhere] = [await delivered(second, secret), await delivered(second, secret, { run: otherRun })];

    expect([again.status, elsewhere.status]).toEqual([404, 401]);
  });
});

describe('the answer addresses of a server that receives nothing', () => {
  it('answer no route, whatever is signed, as CONNECTIONS_RECEIVE_EVENTS or receive_events turns them off', async () => {
    const offByTheVariable = await serving({ CONNECTIONS_RECEIVE_EVENTS: '' });
    const secret = await receiving(offByTheVariable);
    const offByTheSetting = await serving({ CONNECTIONS: JSON.stringify({ receive_events: [] }) });

    const answers = [await delivered(offByTheVariable, secret), await delivered(offByTheSetting, secret)];

    expect(answers.map(({ status }) => status)).toEqual([404, 404]);
    expect(await Promise.all(answers.map((answer) => answer.json()))).toEqual([
      expect.objectContaining({ reason: 'not_found', detail: 'No route matches the path' }),
      expect.objectContaining({ reason: 'not_found', detail: 'No route matches the path' }),
    ]);
  });
});
