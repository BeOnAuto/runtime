import { request } from 'node:http';

import { Function, Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import {
  blobOperations,
  endlessBlob,
  gatedBlob,
  gatedBlobPath,
  silentBlob,
  silentBlobPath,
  sourceFailure,
} from '../testing/blob-operations.ts';
import { exchanged, listenOnLoopback, unanswered } from '../testing/listening.ts';
import { notebookOperations } from '../testing/notebook.ts';
import { acmeAdmin, operationServer, type OperationServerOptions } from '../testing/operation-server.ts';

const asAdmin = { authorization: `Bearer ${acmeAdmin.key}` };

const failingBlobs = '/v1/orgs/acme/playbooks/alpha/failing-blobs';

const blobRead = (operation: string) => ({ operation, org: 'acme', playbook: 'alpha', caller: 'acme-admin' });

async function listening(operations: NonNullable<OperationServerOptions['operations']>) {
  const server = await operationServer({ operations });
  const listened = await listenOnLoopback(server.handler);
  onTestFinished(() => listened.close());
  return { ...server, origin: listened.origin };
}

function listeningWithBlobs() {
  return listening([...notebookOperations, ...blobOperations]);
}

const problemOf = Schema.decodeUnknownSync(Schema.Struct({ reason: Schema.String, instance: Schema.String }));

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

describe('a streamed answer that fails before its first chunk is sent', () => {
  it.each([
    ['whose stream fails before its first chunk', 'at-once', sourceFailure],
    [
      'whose first chunk is longer than it declared',
      'past-its-length',
      'The streamed answer ran past the 3 bytes it declared, to 6',
    ],
  ])(
    'is a problem document of an incident the API reports with the request id and the call, %s',
    async (_case, when, message) => {
      const { origin, thrown } = await listeningWithBlobs();

      const answer = await exchanged(origin, `${failingBlobs}/${when}`, { headers: asAdmin });

      const problem = problemOf(JSON.parse(answer.body));

      expect([answer.status, answer.headers['content-type'], problem.reason]).toEqual([
        500,
        'application/problem+json',
        'internal',
      ]);
      expect(
        thrown().map(({ incident, requestId, call, ...reported }) => [
          `urn:uuid:${incident}`,
          requestId,
          call,
          reported.message,
        ]),
      ).toEqual([[problem.instance, answer.headers['x-request-id'], blobRead('read_failing_blob'), message]]);
    },
  );
});

describe('a streamed answer whose stream fails as the server starts to send it', () => {
  it('aborts the connection before any of the answer is sent, and reports the incident with the call', async () => {
    const { origin, thrown } = await listeningWithBlobs();

    const answer = await exchanged(origin, `${failingBlobs}/part-way`, { headers: asAdmin });
    const next = await exchanged(origin, '/health', { headers: {} });

    expect(answer).toEqual(unanswered);
    expect(thrown().map(({ requestId, call, message }) => [requestId, call, message])).toEqual([
      [expect.stringMatching(uuid), blobRead('read_failing_blob'), sourceFailure],
    ]);
    expect([next.status, next.body]).toEqual([200, '{"status":"ok"}']);
  });

  it('fails the body in process with words that name the incident the API reported', async () => {
    const { handler, thrown } = await operationServer({ operations: [...notebookOperations, ...blobOperations] });

    const answer = await handler.fetch(new Request(`http://localhost${failingBlobs}/part-way`, { headers: asAdmin }));
    const failure: unknown = await answer.text().then(Function.constUndefined, Function.identity);

    expect(answer.status).toBe(200);
    expect(failure).toEqual(
      new Error(`The streamed answer failed before its end; incident ${String(thrown()[0]?.incident)}`),
    );
    expect(thrown()).toHaveLength(1);
  });
});

describe('a streamed answer that goes wrong after the client received its first chunk', () => {
  it.each([
    [
      'its stream fails',
      100,
      (controller: ReadableStreamDefaultController<Uint8Array>) => {
        controller.error(new Error(sourceFailure));
      },
      sourceFailure,
    ],
    [
      'its stream ends short of the bytes it declared',
      100,
      (controller: ReadableStreamDefaultController<Uint8Array>) => {
        controller.close();
      },
      'The streamed answer ended after 6 of the 100 bytes it declared',
    ],
    [
      'its stream runs past the bytes it declared',
      10,
      (controller: ReadableStreamDefaultController<Uint8Array>) => {
        controller.enqueue(new TextEncoder().encode('second,'));
      },
      'The streamed answer ran past the 10 bytes it declared, to 13',
    ],
  ])(
    'is aborted after the bytes it handed over when %s, with nothing of the failure on the wire, and the incident reported with the request id and the call',
    async (_case, bytes, past, message) => {
      const gated = gatedBlob(bytes, past);
      const { origin, thrown } = await listening([...notebookOperations, gated.operation]);

      const answer = await exchanged(origin, gatedBlobPath, { headers: asAdmin, firstPieceReceived: gated.open });
      const next = await exchanged(origin, '/health', { headers: {} });

      expect([answer.status, answer.headers['content-length'], answer.body, answer.whole]).toEqual([
        200,
        String(bytes),
        'first,',
        false,
      ]);
      expect(thrown().map(({ requestId, call, ...reported }) => [requestId, call, reported.message])).toEqual([
        [answer.headers['x-request-id'], blobRead('read_gated_blob'), message],
      ]);
      expect([next.status, next.body]).toEqual([200, '{"status":"ok"}']);
    },
  );
});

describe('a streamed answer the client leaves before its end', () => {
  it('cancels the stream it answers', async () => {
    const watched = endlessBlob();
    const { origin } = await listening([...notebookOperations, watched.operation]);

    const firstChunk = await new Promise<string>((resolve) => {
      const sent = request(`${origin}/v1/orgs/acme/playbooks/alpha/endless-blob`, { headers: asAdmin }, (response) => {
        response.setEncoding('utf8');
        response.once('data', (piece: string) => {
          sent.destroy();
          resolve(piece);
        });
      });
      sent.on('error', Function.constVoid);
      sent.end();
    });

    expect(firstChunk).toBe('first,');
    await expect(watched.cancelled).resolves.toBe(true);
  });

  it('cancels the stream while the server waits for its first chunk, and reports no incident', async () => {
    const silent = silentBlob();
    const { origin, thrown } = await listening([...notebookOperations, silent.operation]);
    const sent = request(`${origin}${silentBlobPath}`, { headers: asAdmin });
    sent.on('error', Function.constVoid);
    sent.end();

    await silent.pulled;
    sent.destroy();
    const next = await exchanged(origin, '/health', { headers: {} });

    await expect(silent.cancelled).resolves.toBe(true);
    expect([next.status, thrown()]).toEqual([200, []]);
  });
});
