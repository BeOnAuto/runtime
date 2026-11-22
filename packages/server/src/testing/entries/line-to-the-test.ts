import { request, type ClientRequest } from 'node:http';

import { Function } from 'effect';

/**
 * A request to the test that started this process, on the port its setting names, whose body the process writes its
 * lines to and never ends: it keeps the process alive until the test or the process closes it, which is no failure.
 */
export function lineToTheTest(port = process.env['TOLD_ON_PORT']): ClientRequest {
  const line = request({ host: '127.0.0.1', port: Number(port), method: 'POST' });
  line.on('error', Function.constVoid);
  line.flushHeaders();
  return line;
}
