import { fork } from 'node:child_process';
import { once } from 'node:events';
import { argv } from 'node:process';

import { assetContentOf, type AssetHolding } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { reportingAccess } from '../src/testing/reporting-access.ts';
import { recordingCallJournal } from '../src/testing/tool-runs.ts';

const mebibyte = 1_048_576;

const pieceBytes = 65_536;

const mebibytes = Number(argv[2] ?? '1');

const encoding = argv[3] === 'base64' ? 'base64' : 'text';

const bytes = Math.max(1, mebibytes * mebibyte);

const decodeServed = Schema.decodeUnknownSync(Schema.Struct({ url: Schema.String }));

function generated(): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull: (controller: Readonly<ReadableStreamDefaultController<Uint8Array>>) => {
      if (sent >= bytes) {
        controller.close();
        return;
      }
      const piece = new Uint8Array(Math.min(pieceBytes, bytes - sent)).fill(0x78);
      sent += piece.byteLength;
      controller.enqueue(piece);
    },
  });
}

const reference = {
  id: '019a5b12-0000-7000-8000-000000000001',
  media_type: 'text/markdown',
  bytes,
  sha256: 'a'.repeat(64),
  address: null,
  address_until: null,
};

const held: AssetHolding = {
  held: () =>
    Effect.succeed({
      id: reference.id,
      mediaType: reference.media_type,
      bytes,
      sha256: reference.sha256,
      content: assetContentOf(reference.media_type),
      opened: () => Effect.succeed(generated()),
    }),
};

const server = fork(new URL('asset-call-server.ts', import.meta.url), { execArgv: [] });
const served: readonly unknown[] = await once(server, 'message');
const { url } = decodeServed(served[0]);
const { access } = reportingAccess(
  { graph: { url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' } },
  {
    environment: { GRAPH_API_KEY: 'graph-api-key-4f1d9a7c2b' },
    mostRequestBytes: 1024 * mebibyte,
    assets: held,
    timing: { callMs: 300_000, openMs: 20_000, longestRetryWaitMs: 0 },
  },
);
const called = await Effect.runPromise(
  access.callOnce(
    {
      org: 'acme',
      playbook: 'alpha',
      reference: { server: 'graph', tool: encoding === 'base64' ? 'upload' : 'save' },
      input: { path: 'docs/reference.md', content: reference },
      meta: { 'auto.on/run_id': '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a' },
    },
    { callId: 'call-1', journal: recordingCallJournal() },
  ),
);
await access.close();
server.kill();
process.exitCode = called.kind === 'answered' && called.outcome === 'result' ? 0 : 1;
