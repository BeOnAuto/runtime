import { once } from 'node:events';
import { createServer, type IncomingMessage } from 'node:http';

import { onTestFinished } from 'vitest';

import { tcpPort } from '../../lifecycle/http-server.ts';

/** The setting a child process reads to reach its test: the port the test listens on. */
const toldOnPort = 'TOLD_ON_PORT';

export interface LineToTheTest {
  /** The settings to start the child with, so it reaches the test. */
  readonly environment: Readonly<Record<typeof toldOnPort, string>>;
  /**
   * Answers once the child said the line, before or after it is asked, as a connection loses nothing; fails at once,
   * naming the line, if the child ended first.
   */
  readonly said: (line: string, ended: Promise<unknown>) => Promise<void>;
}

/**
 * A line a child process the test starts says what it did on, one line at a time, in the body of a request it never
 * ends: a signal the test awaits that no change to a watched folder stands in for, since a recursive watch on macOS
 * has missed writes.
 */
export async function aLineToTheTest(): Promise<LineToTheTest> {
  const said = new Map<string, PromiseWithResolvers<void>>();
  const of = (line: string): PromiseWithResolvers<void> => {
    const known = said.get(line) ?? Promise.withResolvers<void>();
    said.set(line, known);
    return known;
  };
  const partial = { line: '' };
  const listening = createServer((request: IncomingMessage) => {
    request.setEncoding('utf8').on('data', (chunk: string) => {
      const text = `${partial.line}${chunk}`;
      const ended = text.lastIndexOf('\n') + 1;
      partial.line = text.slice(ended);
      for (const line of text.slice(0, ended).split('\n').slice(0, -1)) {
        of(line).resolve();
      }
    });
  });
  listening.listen(0, '127.0.0.1');
  await once(listening, 'listening');
  onTestFinished(() => {
    listening.closeAllConnections();
    listening.close();
  });
  return {
    environment: { [toldOnPort]: String(tcpPort(listening.address())) },
    said: async (line, ended) => {
      await Promise.race([
        of(line).promise,
        ended.then(() => {
          throw new Error(`The process ended before it said ${line}`);
        }),
      ]);
    },
  };
}
