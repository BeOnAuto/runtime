import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { tcpPort } from '../lifecycle/http-server.ts';
import { aPortNothingListensOn } from '../testing/processes/free-port.ts';
import { pingOf } from './runtime-connection.ts';

type Answering = (asked: IncomingMessage, answer: ServerResponse, body: string) => void;

async function listening(answering: Answering): Promise<number> {
  const server = createServer((asked, answer) => {
    let body = '';
    asked.setEncoding('utf8');
    asked.on('data', (piece: string) => {
      body += piece;
    });
    asked.on('end', () => {
      answering(asked, answer, body);
    });
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  onTestFinished(async () => {
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  });
  return tcpPort(server.address());
}

function idIn(body: string): unknown {
  const asked: unknown = JSON.parse(body);
  return typeof asked === 'object' && asked !== null && 'id' in asked ? asked.id : undefined;
}

const likeARuntime: Answering = (_asked: IncomingMessage, answer: ServerResponse, body: string) => {
  answer.writeHead(200, { 'content-type': 'application/json' });
  answer.end(JSON.stringify({ jsonrpc: '2.0', id: idIn(body), result: {} }));
};

const talkativeRuntime: Answering = (_asked: IncomingMessage, answer: ServerResponse, body: string) => {
  answer.writeHead(200, { 'content-type': 'text/event-stream' });
  answer.write(`data: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/message', params: {} })}\n\n`);
  answer.write(`data: ${JSON.stringify({ jsonrpc: '2.0', id: 'another', result: {} })}\n\n`);
  answer.end(`data: ${JSON.stringify({ jsonrpc: '2.0', id: idIn(body), result: {} })}\n\n`);
};

const askingForAKey: Answering = (_asked: IncomingMessage, answer: ServerResponse) => {
  answer.writeHead(401, { 'content-type': 'application/problem+json', 'www-authenticate': 'Bearer' });
  answer.end(JSON.stringify({ status: 401, reason: 'unauthenticated' }));
};

const notARuntime: Answering = (_asked: IncomingMessage, answer: ServerResponse) => {
  answer.writeHead(200, { 'content-type': 'text/html' });
  answer.end('<html>hello</html>');
};

const nothingThere: Answering = (_asked: IncomingMessage, answer: ServerResponse) => {
  answer.writeHead(404, { 'content-type': 'text/plain' });
  answer.end('not found');
};

describe('the ping of the relay at the MCP endpoint of a port', () => {
  it.each<readonly [string, Answering, string]>([
    ['a runtime that answers it', likeARuntime, 'answers'],
    ['a runtime that streams other messages before its answer', talkativeRuntime, 'answers'],
    ['a runtime that asks for a credential', askingForAKey, 'asks for a credential'],
    ['a program that answers with a page', notARuntime, 'not a runtime'],
    ['a program with no MCP endpoint', nothingThere, 'not a runtime'],
  ])('tells %s', async (_case, answering, outcome) => {
    const port = await listening(answering);

    await expect(Effect.runPromise(pingOf(port))).resolves.toBe(outcome);
  });

  it('tells a port that refuses the connection', async () => {
    const port = await aPortNothingListensOn();

    await expect(Effect.runPromise(pingOf(port))).resolves.toBe('refused');
  });
});
