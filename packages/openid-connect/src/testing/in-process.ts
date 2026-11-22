import { request, type IncomingMessage, type Server } from 'node:http';
import { duplexPair } from 'node:stream';

import type { Fetching } from './browser.ts';

function headersOf(raw: readonly string[]): Headers {
  const headers = new Headers();
  const named = { last: '' };
  raw.forEach((part, place) => {
    if (place % 2 === 0) {
      named.last = part;
      return;
    }
    headers.append(named.last, part);
  });
  return headers;
}

export function fetchInProcess(server: Server): Fetching {
  return async (address, { method, headers, body }) => {
    const [near, far] = duplexPair();
    server.emit('connection', far);
    const { host, pathname, search } = new URL(address);
    const answered = Promise.withResolvers<IncomingMessage>();
    const asked = request(
      { createConnection: () => near, method, path: `${pathname}${search}`, headers: { ...headers, host } },
      answered.resolve,
    );
    asked.on('error', answered.reject);
    asked.end(body);
    const message = await answered.promise;
    const content = Buffer.concat(await message.toArray());
    return new Response(content, { status: Number(message.statusCode), headers: headersOf(message.rawHeaders) });
  };
}
