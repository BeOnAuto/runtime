import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { costHeader, onePixelPng, spokenBytes } from '@on.auto/generation/testing';
import { onTestFinished } from 'vitest';

import { compositionRoot } from '../../composition/composition-root.ts';
import { tcpPort } from '../../lifecycle/http-server.ts';
import { startServer } from '../../lifecycle/lifecycle.ts';
import type { TemporaryLedger } from '../records/temporary-ledger.ts';
import { request, type RequestOptions, type TestResponse } from './http-client.ts';
import { loopbackSettingsOver } from './reasoning-server.ts';

interface AskedOfTheGateway {
  readonly path: string;
  readonly authorization: string | undefined;
  readonly body: unknown;
}

export interface GatewayOnTheLoopback {
  readonly gateways: string;
  readonly asked: () => readonly AskedOfTheGateway[];
}

async function bodyOf(incoming: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of incoming) {
    chunks.push(Buffer.from(String(chunk)));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function answered(response: ServerResponse, path: string): void {
  if (path.endsWith('/audio/speech')) {
    response.writeHead(200, { 'content-type': 'audio/mpeg', [costHeader]: '0.002' }).end(spokenBytes);
    return;
  }
  response
    .writeHead(200, { 'content-type': 'application/json', [costHeader]: '0.04' })
    .end(JSON.stringify({ data: [{ b64_json: onePixelPng.toString('base64') }] }));
}

export async function gatewayOnTheLoopback(): Promise<GatewayOnTheLoopback> {
  const asked: AskedOfTheGateway[] = [];
  const server = createServer((incoming, response) => {
    const path = String(incoming.url);
    void bodyOf(incoming).then((body) => {
      asked.push({ path, authorization: incoming.headers.authorization, body });
      answered(response, path);
      return path;
    });
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  onTestFinished(() => {
    server.closeAllConnections();
    server.close();
  });
  const baseUrl = `http://127.0.0.1:${tcpPort(server.address())}/v1`;
  return {
    gateways: JSON.stringify([
      { name: 'gateway', base_url: baseUrl, api_key: 'gateway-test-key', cost_header: costHeader },
    ]),
    asked: () => [...asked],
  };
}

export interface GenerationServer {
  readonly origin: string;
  readonly call: (method: string, path: string, options?: RequestOptions) => Promise<TestResponse>;
  readonly stop: () => Promise<void>;
}

export async function servingGeneration(
  gateway: GatewayOnTheLoopback,
  ledger: TemporaryLedger,
): Promise<GenerationServer> {
  const server = await startServer(
    { ...loopbackSettingsOver(ledger), MODEL_GATEWAYS: gateway.gateways },
    compositionRoot,
  );
  return {
    origin: `http://127.0.0.1:${server.port}`,
    call: (method, path, options) => request(server.port, method, path, options),
    stop: () => server.stop(),
  };
}
