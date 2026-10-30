import type { ApiHandler } from '../index.ts';

export interface RawAnswer {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
}

const mcpHeaders = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

export function initializeAt(protocolVersion: string): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion, capabilities: {}, clientInfo: { name: 'auto-runtime-tests', version: '1' } },
  });
}

const initializeRequest = initializeAt('2025-11-25');

export function requestOf(id: number, method: string, params: Readonly<Record<string, unknown>> = {}): string {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params });
}

export function jsonOf(text: string): unknown {
  const parsed: unknown = JSON.parse(text);
  return parsed;
}

export function messagesIn({ text }: RawAnswer): readonly unknown[] {
  return text
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => jsonOf(line.slice('data: '.length)));
}

export async function postMcp(
  handler: ApiHandler,
  path: string,
  headers: Readonly<Record<string, string>>,
  body = initializeRequest,
): Promise<RawAnswer> {
  const response = await handler.fetch(
    new Request(`http://localhost${path}`, { method: 'POST', headers: { ...mcpHeaders, ...headers }, body }),
  );
  return { status: response.status, headers: response.headers, text: await response.text() };
}
