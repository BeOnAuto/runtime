import { Buffer } from 'node:buffer';

import { Redacted } from 'effect';

import type { GatewayFetch, GenerationGateway } from '../gateway/generation-gateway.ts';

export const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

export const spokenBytes = Buffer.from('ID3 spoken words of the test');

interface SentFile {
  readonly name: string;
  readonly type: string;
  readonly bytes: number;
}

export interface AskedOfTheGateway {
  readonly path: string;
  readonly search: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly files: readonly SentFile[];
}

export type GatewayAnswering = (asked: AskedOfTheGateway) => Response;

export interface FakeGateway {
  readonly settings: GenerationGateway;
  readonly fetch: GatewayFetch;
  readonly asked: () => readonly AskedOfTheGateway[];
}

export const costHeader = 'x-generation-cost';

export const fakeGatewaySettings: GenerationGateway = {
  name: 'gateway',
  base_url: 'https://gateway.example/v1',
  api_key: Redacted.make('gateway-test-key'),
  headers: new Map([['x-team', Redacted.make('team-7')]]),
  query_params: new Map([['region', Redacted.make('eu')]]),
  cost_header: costHeader,
};

export function answeredByKind(cost = '0.04'): GatewayAnswering {
  return ({ path }) =>
    path.endsWith('/audio/speech')
      ? new Response(spokenBytes, { headers: { 'content-type': 'audio/mpeg', [costHeader]: cost } })
      : Response.json({ data: [{ b64_json: onePixelPng.toString('base64') }] }, { headers: { [costHeader]: cost } });
}

export function answeredWith(status: number, body: unknown): GatewayAnswering {
  return () => Response.json(body, { status });
}

const partOfAForm = /name="([^"]*)"(?:; filename="([^"]*)"\r\nContent-Type: ([^\r]*))?\r\n\r\n([\s\S]*?)\r\n--/gu;

interface Form {
  readonly fields: Readonly<Record<string, string>>;
  readonly files: readonly SentFile[];
}

function formOf(text: string): Form {
  const fields: Record<string, string> = {};
  const files: SentFile[] = [];
  for (const [, name, file, type, value] of text.matchAll(partOfAForm)) {
    if (file === undefined) {
      fields[String(name)] = String(value);
    } else {
      files.push({ name: file, type: String(type), bytes: String(value).length });
    }
  }
  return { fields, files };
}

async function askedOf(request: Readonly<Request>): Promise<AskedOfTheGateway> {
  const { pathname, search } = new URL(request.url);
  const headers = Object.fromEntries(request.headers);
  if (!String(headers['content-type']).startsWith('multipart/form-data')) {
    const body: unknown = await request.json();
    return { path: pathname, search, headers, body, files: [] };
  }
  const { fields, files } = formOf(new TextDecoder('latin1').decode(await request.arrayBuffer()));
  return { path: pathname, search, headers, body: fields, files };
}

export function fakeGateway(answering: GatewayAnswering = answeredByKind()): FakeGateway {
  const asked: AskedOfTheGateway[] = [];
  return {
    settings: fakeGatewaySettings,
    fetch: async (request) => {
      const seen = await askedOf(request);
      asked.push(seen);
      return answering(seen);
    },
    asked: () => asked,
  };
}
