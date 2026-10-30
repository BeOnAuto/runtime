import { createApiKey } from '@on.auto/identity';
import { allPermissions } from '@on.auto/operations';
import { Schema } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { compositionRoot } from '../composition/composition-root.ts';
import { startServer } from '../lifecycle/lifecycle.ts';
import { type RunningServer } from '../server-options/server-options.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { request } from '../testing/servers/http-client.ts';

const acmeAdmin = createApiKey({ id: 'acme-admin', org: 'acme', permissions: allPermissions, playbooks: '*' });

const alphaReader = createApiKey({
  id: 'alpha-reader',
  org: 'acme',
  permissions: ['playbook:read'],
  playbooks: ['alpha'],
});

const AnswerSchema = Schema.Struct({ cursor: Schema.String });

let ledger: TemporaryLedger;
let server: RunningServer;

beforeEach(async () => {
  ledger = temporaryLedger();
  server = await startServer(
    {
      HOST: '127.0.0.1',
      PORT: '0',
      LEDGER_FILE: ledger.fileName,
      API_KEYS: JSON.stringify([acmeAdmin.entry, alphaReader.entry]),
    },
    compositionRoot,
  );
});

afterEach(async () => {
  await server.stop();
  ledger.remove();
});

function asAdmin(method: string, path: string, body?: unknown) {
  return request(server.port, method, path, { key: acmeAdmin.key, ...(body === undefined ? {} : { body }) });
}

function asReader(path: string) {
  return request(server.port, 'GET', path, { key: alphaReader.key });
}

describe('the changes of an org to a key limited to some of its playbooks', () => {
  it('name none of the playbooks it may not access, give back the cursor it gave, and name those it may', async () => {
    const now = Schema.decodeUnknownSync(AnswerSchema)((await asReader('/v1/orgs/acme/changes')).body).cursor;
    await asAdmin('POST', '/v1/orgs/acme/playbooks', { playbook: 'beta', name: 'Beta' });
    await asAdmin('PUT', '/v1/orgs/acme/playbooks/beta', { name: 'Bet', description: '' });
    await asAdmin('POST', '/v1/orgs/acme/playbooks/beta/retire');

    const started = performance.now();
    const unseen = await asReader(`/v1/orgs/acme/changes?since=${now}&wait=1`);
    const held = performance.now() - started;
    await asAdmin('POST', '/v1/orgs/acme/playbooks', { playbook: 'alpha', name: 'Alpha' });
    const seen = await asReader(`/v1/orgs/acme/changes?since=${now}&wait=0`);

    expect(unseen).toMatchObject({ status: 200, body: { cursor: now, changes: [], more: false } });
    expect(held).toBeGreaterThanOrEqual(900);
    expect(seen).toMatchObject({ status: 200, body: { changes: [{ kind: 'playbook', playbook: 'alpha' }] } });
  });
});
