import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { onTestFinished } from 'vitest';

import { tcpPort } from '../../lifecycle/http-server.ts';

export interface ToolGateway {
  readonly gateways: string;
  readonly bodies: () => readonly string[];
  readonly secondHeard: Promise<void>;
}

const usage = { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 };

function completion(message: object, finishReason: string): string {
  return JSON.stringify({
    id: 'chatcmpl-stub',
    object: 'chat.completion',
    created: 1_790_000_000,
    model: 'stub',
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage,
  });
}

export interface AskedTool {
  readonly name: string;
  readonly arguments: string;
}

const search: AskedTool = { name: 'graph__search', arguments: '{"query":"acme"}' };

function asking(tool: AskedTool): string {
  return completion(
    { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: tool }] },
    'tool_calls',
  );
}

const answering = completion({ role: 'assistant', content: 'Acme has 2 rows.' }, 'stop');

async function bodyOf(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function answered(response: ServerResponse, body: string): void {
  response.setHeader('content-type', 'application/json');
  response.end(body);
}

export async function gatewayThatHangsAfterATool(tool: AskedTool = search): Promise<ToolGateway> {
  const heard = Promise.withResolvers<void>();
  const bodies: string[] = [];
  const server = createServer((request, response) => {
    void bodyOf(request).then((body) => {
      if (String(request.url).endsWith('/models')) {
        answered(response, JSON.stringify({ object: 'list', data: [] }));
        return 'listed';
      }
      bodies.push(body);
      if (bodies.length === 2) {
        heard.resolve();
        return 'held';
      }
      answered(response, bodies.length === 1 ? asking(tool) : answering);
      return 'answered';
    });
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  onTestFinished(() => {
    server.closeAllConnections();
    server.close();
  });
  return {
    gateways: JSON.stringify([{ name: 'stub', base_url: `http://127.0.0.1:${tcpPort(server.address())}/v1` }]),
    bodies: () => [...bodies],
    secondHeard: heard.promise,
  };
}
