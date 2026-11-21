import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { Schema } from 'effect';

import { answerTo, kmsStoreOf, targetPrefix, type FakeKms, type FakeKmsOptions, type Kept } from './fake-kms.ts';

const decodeAddress = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }));

async function bodyOf(request: IncomingMessage): Promise<string> {
  request.setEncoding('utf8');
  let text = '';
  for await (const chunk of request) {
    text += String(chunk);
  }
  return text;
}

async function respond(request: IncomingMessage, response: ServerResponse, kept: Kept): Promise<void> {
  const operation = String(request.headers['x-amz-target']).replace(targetPrefix, '');
  const answer = answerTo(operation, await bodyOf(request), kept);
  if (answer !== 'stalled') {
    response
      .writeHead(answer.status, { 'content-type': 'application/x-amz-json-1.1' })
      .end(JSON.stringify(answer.body));
  }
}

export async function serveFakeKms(options: FakeKmsOptions): Promise<FakeKms> {
  const { kept, controls } = kmsStoreOf(options);
  const server = createServer();
  server.on('request', (request: IncomingMessage, response: ServerResponse) => {
    void respond(request, response, kept);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    ...controls,
    url: `http://127.0.0.1:${String(decodeAddress(server.address()).port)}`,
    close: async () => {
      const closed = once(server, 'close');
      server.close();
      server.closeAllConnections();
      await closed;
    },
  };
}
