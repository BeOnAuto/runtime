import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { compositionRoot } from '../composition/composition-root.ts';
import { startServer } from '../lifecycle/lifecycle.ts';
import { type RunningServer } from '../server-options/server-options.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { request, type TestResponse } from '../testing/servers/http-client.ts';
import { noConsentThroughAuto } from '../testing/settings/no-consent-through-auto.ts';

const playbooks = '/v1/orgs/acme/playbooks';

let ledger: TemporaryLedger;
let server: RunningServer;

beforeEach(async () => {
  ledger = temporaryLedger();
  server = await startServer(
    {
      HOST: '127.0.0.1',
      PORT: '0',
      LEDGER_FILE: ledger.fileName,
      PREDICTION_CACHE_DIR: ledger.cacheDirectory,
      ...noConsentThroughAuto,
    },
    compositionRoot,
  );
});

afterEach(async () => {
  await server.stop();
  ledger.remove();
});

function create(body: unknown): Promise<TestResponse> {
  return request(server.port, 'POST', playbooks, { body });
}

function cacheControlOf(response: TestResponse): string | null {
  return response.headers.get('cache-control');
}

describe('the playbooks of an org over HTTP in local mode', () => {
  it('creates a playbook with 201, trimmed, active and created by the local developer', async () => {
    const created = await create({ playbook: 'alpha', name: '  Alpha  ', description: 'Sales' });

    expect(created).toMatchObject({
      status: 201,
      body: { id: 'alpha', name: 'Alpha', description: 'Sales', status: 'active', created_by: 'local' },
    });
    expect(cacheControlOf(created)).toBe('no-store');
  });

  it('lists, reads, updates and retires a playbook, each with 200 and no caching', async () => {
    await create({ playbook: 'alpha', name: 'Alpha' });

    const listed = await request(server.port, 'GET', playbooks);
    const read = await request(server.port, 'GET', `${playbooks}/alpha`);
    const updated = await request(server.port, 'PUT', `${playbooks}/alpha`, {
      body: { name: 'Alpha two', description: '' },
    });
    const retired = await request(server.port, 'POST', `${playbooks}/alpha/retire`);
    const listedAfter = await request(server.port, 'GET', playbooks);
    const listedWithRetired = await request(server.port, 'GET', `${playbooks}?include_retired=true`);

    expect([listed, read, updated, retired].map(({ status }) => status)).toEqual([200, 200, 200, 200]);
    expect([listed, read, updated, retired].map((response) => cacheControlOf(response))).toEqual([
      'no-store',
      'no-store',
      'no-store',
      'no-store',
    ]);
    expect(listed.body).toMatchObject({ playbooks: [{ id: 'alpha', name: 'Alpha' }] });
    expect(read.body).toMatchObject({ id: 'alpha', status: 'active' });
    expect(updated.body).toMatchObject({ id: 'alpha', name: 'Alpha two', description: '' });
    expect(retired.body).toMatchObject({ id: 'alpha', status: 'retired' });
    expect(listedAfter.body).toEqual({ playbooks: [] });
    expect(listedWithRetired.body).toMatchObject({ playbooks: [{ id: 'alpha', status: 'retired' }] });
  });
});

describe('the rejections of the playbook operations over HTTP', () => {
  it('rejects an id the org already has, even after it is retired, with 409', async () => {
    await create({ playbook: 'alpha', name: 'Alpha' });
    const taken = await create({ playbook: 'alpha', name: 'Again' });
    await request(server.port, 'POST', `${playbooks}/alpha/retire`);
    const takenWhileRetired = await create({ playbook: 'alpha', name: 'Again' });

    expect([taken, takenWhileRetired]).toMatchObject([
      { status: 409, body: { reason: 'conflict' } },
      { status: 409, body: { reason: 'conflict' } },
    ]);
  });

  it('answers 404 for a playbook the org does not have', async () => {
    const responses = await Promise.all([
      request(server.port, 'GET', `${playbooks}/nobody`),
      request(server.port, 'PUT', `${playbooks}/nobody`, { body: { name: 'Nobody', description: '' } }),
      request(server.port, 'POST', `${playbooks}/nobody/retire`),
    ]);

    expect(responses.map(({ status, body }) => ({ status, body }))).toMatchObject([
      { status: 404, body: { reason: 'not_found' } },
      { status: 404, body: { reason: 'not_found' } },
      { status: 404, body: { reason: 'not_found' } },
    ]);
  });

  it('rejects invalid input with 422, pointing at every problem', async () => {
    expect(await create({ playbook: 'A', name: '', colour: 'red' })).toMatchObject({
      status: 422,
      body: {
        reason: 'invalid_input',
        errors: [{ pointer: '/colour' }, { pointer: '/playbook' }, { pointer: '/name' }],
      },
    });
  });
});

describe('a retired playbook over HTTP', () => {
  it('rejects an update with 409', async () => {
    await create({ playbook: 'alpha', name: 'Alpha' });
    await request(server.port, 'POST', `${playbooks}/alpha/retire`);

    expect(
      await request(server.port, 'PUT', `${playbooks}/alpha`, { body: { name: 'Back', description: '' } }),
    ).toMatchObject({
      status: 409,
      body: { reason: 'conflict', detail: 'The playbook alpha is retired and can no longer change' },
    });
  });

  it('answers a repeated update and a repeated retire with 200, changing nothing', async () => {
    await create({ playbook: 'alpha', name: 'Alpha' });
    const update = { body: { name: 'Alpha', description: '' } };

    const [firstUpdate, secondUpdate] = [
      await request(server.port, 'PUT', `${playbooks}/alpha`, update),
      await request(server.port, 'PUT', `${playbooks}/alpha`, update),
    ];
    const [firstRetire, secondRetire] = [
      await request(server.port, 'POST', `${playbooks}/alpha/retire`),
      await request(server.port, 'POST', `${playbooks}/alpha/retire`),
    ];

    expect([firstUpdate.status, secondUpdate.status, firstRetire.status, secondRetire.status]).toEqual([
      200, 200, 200, 200,
    ]);
    expect(secondUpdate.body).toEqual(firstUpdate.body);
    expect(secondRetire.body).toEqual(firstRetire.body);
  });
});
