import { Buffer } from 'node:buffer';
import { Readable } from 'node:stream';

interface AwsAnswer {
  readonly status: number;
  readonly body: unknown;
}

export type AwsAnswering = AwsAnswer | 'stalled';

export interface AwsAsked {
  readonly target: string;
  readonly body: string;
  readonly userAgent: string | undefined;
}

interface AwsRequest {
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

interface AwsResponse {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Readable;
}

export interface InProcessRequestHandler {
  readonly handle: (request: AwsRequest) => Promise<{ readonly response: AwsResponse }>;
}

class StalledPastTheBound extends Error {
  override readonly name = 'TimeoutError';
}

function headerOf({ headers }: Readonly<AwsRequest>, name: string): string | undefined {
  return new Map(Object.keys(headers).map((each) => [each.toLowerCase(), headers[each]])).get(name);
}

export function inProcessHandler(answer: (asked: AwsAsked) => AwsAnswering): InProcessRequestHandler {
  return {
    handle: (request) => {
      const answered = answer({
        target: String(headerOf(request, 'x-amz-target')),
        body: String(request.body),
        userAgent: headerOf(request, 'user-agent'),
      });
      return answered === 'stalled'
        ? Promise.reject(new StalledPastTheBound('The fake did not answer within the bound of the request'))
        : Promise.resolve({
            response: {
              statusCode: answered.status,
              headers: { 'content-type': 'application/x-amz-json-1.1' },
              body: Readable.from([Buffer.from(JSON.stringify(answered.body))]),
            },
          });
    },
  };
}
