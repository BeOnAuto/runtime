import type { HoldingServer } from './spawned-server.ts';

export async function isAcceptingConnections(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/health`);
    return true;
  } catch {
    return false;
  }
}

/**
 * The line the test entry says to its test after each stop signal, once the server's handlers of that signal ran: the
 * first closed its listener then, so the server takes no new connection.
 */
export const listenerClosedLine = 'listener closed';

/** Answers once a server the test entry runs has closed its listener after a stop signal, as it says to its test. */
export async function untilItsListenerClosed({ child, line }: Pick<HoldingServer, 'child' | 'line'>): Promise<void> {
  await line.said(listenerClosedLine, child.exited);
}
