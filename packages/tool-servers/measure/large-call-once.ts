import { fork } from 'node:child_process';
import { once } from 'node:events';
import { argv } from 'node:process';

import { Effect, Schema } from 'effect';

import { reportingAccess } from '../src/testing/reporting-access.ts';
import { recordingCallJournal } from '../src/testing/tool-runs.ts';

const mebibyte = 1_048_576;

const mebibytes = Number(argv[2] ?? '1');

const decodeServed = Schema.decodeUnknownSync(Schema.Struct({ url: Schema.String }));

const server = fork(new URL('large-call-server.ts', import.meta.url), { execArgv: [] });
const served: readonly unknown[] = await once(server, 'message');
const { url } = decodeServed(served[0]);
const { access } = reportingAccess(
  { graph: { url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' } },
  {
    environment: { GRAPH_API_KEY: 'graph-api-key-4f1d9a7c2b' },
    mostRequestBytes: 128 * mebibyte,
    timing: { callMs: 120_000, openMs: 20_000, longestRetryWaitMs: 0 },
  },
);
await Effect.runPromise(
  access.callOnce(
    {
      org: 'acme',
      playbook: 'alpha',
      reference: { server: 'graph', tool: 'save' },
      input: { path: 'docs/reference.md', content: 'x'.repeat(Math.max(1, mebibytes * mebibyte)) },
      meta: { 'auto.on/run_id': '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a' },
    },
    { callId: 'call-1', journal: recordingCallJournal() },
  ),
);
await access.close();
server.kill();
