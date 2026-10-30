import { createApiKey } from '@on.auto/identity';
import { allPermissions } from '@on.auto/operations';
import { uploadedDailyVisits } from '@on.auto/prediction/testing';
import { Schema } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { compositionRoot } from '../composition/composition-root.ts';
import { startServer } from '../lifecycle/lifecycle.ts';
import { type RunningServer } from '../server-options/server-options.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { buildRoute, candidateBytes, visits } from './build-calls.ts';

const admin = createApiKey({ id: 'acme-admin', org: 'acme', permissions: allPermissions, playbooks: '*' });

const reader = createApiKey({
  id: 'acme-reader',
  org: 'acme',
  permissions: ['org:read', 'playbook:read'],
  playbooks: '*',
});

const outsider = createApiKey({ id: 'acme-outsider', org: 'acme', permissions: ['org:read'], playbooks: '*' });

const StartedSchema = Schema.Struct({ run_id: Schema.String });

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
      API_KEYS: JSON.stringify([admin.entry, reader.entry, outsider.entry]),
    },
    compositionRoot,
  );
});

afterEach(async () => {
  await server.stop();
  ledger.remove();
});

interface Sent {
  readonly method: string;
  readonly key: string;
  readonly type?: string;
  readonly body?: string | Readonly<Uint8Array>;
}

async function sent(
  path: string,
  { method, key, type, body }: Sent,
): Promise<{ readonly status: number; readonly text: string }> {
  const response = await fetch(`http://127.0.0.1:${server.port}${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, ...(type === undefined ? {} : { 'content-type': type }) },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : new Uint8Array(body) }),
  });
  return { status: response.status, text: await response.text() };
}

async function waitingBuild(): Promise<string> {
  const json = 'application/json';
  await sent('/v1/orgs/acme/playbooks', {
    method: 'POST',
    key: admin.key,
    type: json,
    body: JSON.stringify({ playbook: 'alpha', name: 'Alpha' }),
  });
  const alpha = '/v1/orgs/acme/playbooks/alpha';
  await sent(`${alpha}/datasets/${visits.sha256}`, {
    method: 'PUT',
    key: admin.key,
    type: 'text/csv',
    body: visits.text,
  });
  const source = uploadedDailyVisits(visits.sha256);
  await sent(`${alpha}/definitions/prediction`, {
    method: 'POST',
    key: admin.key,
    type: json,
    body: JSON.stringify({ name: 'daily-visits', source }),
  });
  const asked = await sent(`${alpha}/definitions/prediction/daily-visits/run`, {
    method: 'POST',
    key: admin.key,
    type: json,
    body: JSON.stringify({ input: { build: {} } }),
  });
  return Schema.decodeUnknownSync(Schema.fromJsonString(StartedSchema))(asked.text).run_id;
}

describe('the routes a trainer calls under API keys', () => {
  it('read a build for a key that may read the playbook, and take a candidate from a key that may write it alone', async () => {
    const build = await waitingBuild();
    const candidate = candidateBytes('visits-mean');
    const octets = 'application/octet-stream';

    const [read, refused, readOnly, written] = [
      await sent(buildRoute(build, 'brief'), { method: 'GET', key: reader.key }),
      await sent(buildRoute(build, 'rows'), { method: 'GET', key: outsider.key }),
      await sent(`${buildRoute(build, 'candidates')}?format=series`, {
        method: 'POST',
        key: reader.key,
        type: octets,
        body: candidate,
      }),
      await sent(`${buildRoute(build, 'candidates')}?format=series`, {
        method: 'POST',
        key: admin.key,
        type: octets,
        body: candidate,
      }),
    ];

    expect([read.status, read.text.split('\n', 1)]).toEqual([
      200,
      ['Fit a model of the daily visits of each of 2 stores.'],
    ]);
    expect([refused.status, readOnly.status, written.status]).toEqual([403, 403, 200]);
  });
});
