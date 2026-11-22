import type { ClientRequest } from 'node:http';

import { waitForeverAnnouncing } from '@on.auto/api/testing';
import { Function } from 'effect';

import { lineToTheTest } from './line-to-the-test.ts';

/** The line a test entry says once a call it holds is in flight. */
export const callInFlightLine = 'call in flight';

/** A socket that keeps the process running no longer than it would without it. */
function unreferenced(socket: { readonly unref: () => unknown }): void {
  socket.unref();
}

/**
 * Says each line to the test that started this process, on a line to the test opened as the first is said, or to no
 * one where the test gave no line. The line keeps the process running no longer than it would run without it, since
 * the process's exit is what its test proves.
 */
export function toldToTheTest(port = process.env['TOLD_ON_PORT']): (line: string) => void {
  if (port === undefined) {
    return Function.constVoid;
  }
  const opened: { line?: ClientRequest } = {};
  return (line) => {
    opened.line ??= lineToTheTest(port).on('socket', unreferenced);
    opened.line.write(`${line}\n`);
  };
}

export function waitForeverAnnounced(say: (line: string) => void) {
  return waitForeverAnnouncing(() => {
    say(callInFlightLine);
  });
}
