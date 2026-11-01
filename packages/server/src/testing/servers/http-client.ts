import { Schema } from 'effect';

export interface TestResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
  readonly body: unknown;
}

export interface RequestOptions {
  readonly key?: string;
  readonly authorization?: string;
  readonly body?: unknown;
}

function authorizationOf({ key, authorization }: RequestOptions): Readonly<Record<string, string>> {
  if (authorization !== undefined) {
    return { authorization };
  }
  return key === undefined ? {} : { authorization: `Bearer ${key}` };
}

export async function request(
  port: number,
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<TestResponse> {
  const { body } = options;
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      ...authorizationOf(options),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, headers: response.headers, text, body: JSON.parse(text) };
}

const fieldsOf = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown));

export function withoutStudioLink(answer: unknown): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(fieldsOf(answer)).filter(([field]: readonly [string, unknown]) => field !== 'studio'),
  );
}
