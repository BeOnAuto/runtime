import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout } from 'node:timers/promises';

import { ReadBuffer, type JSONRPCMessage, type Transport } from '@modelcontextprotocol/client';

import { toolBounds } from '../bounds/call-bounds.ts';
import { ignored } from './ignored.ts';
import { boundedReport, type OutputReport } from './mcp-client.ts';
import type { Observations, SendOptions } from './observed-requests.ts';

export interface StdioParameters {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

const mostPendingCharacters = 65_536;

const patienceMs = 2000;

export const outputNoLongerReported = 'The MCP server wrote more to stderr than is reported; the rest is not shown';

function lineReporter(output: OutputReport): (chunk: string) => void {
  const reportLine = boundedReport(output, outputNoLongerReported);
  let pending = '';
  return (chunk) => {
    const lines = `${pending}${chunk}`.split('\n');
    pending = lines.splice(-1).join('').slice(0, mostPendingCharacters);
    for (const line of lines.filter((each) => each.trim() !== '')) {
      reportLine(line);
    }
  };
}

export class StdioProcessTransport implements Transport {
  onclose?: Transport['onclose'];
  onerror?: Transport['onerror'];
  onmessage?: Transport['onmessage'];
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #observations: Observations;
  readonly #readBuffer = new ReadBuffer({ maxBufferSize: toolBounds.stdioOutputBytes });
  readonly #spawned: Promise<unknown>;
  readonly #closed: Promise<unknown>;

  constructor(parameters: StdioParameters, observed: Observations, output: OutputReport) {
    const child = spawn(parameters.command, [...parameters.args], {
      env: { ...parameters.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });
    this.#child = child;
    this.#observations = observed;
    this.#spawned = once(child, 'spawn');
    this.#closed = new Promise((resolve) => {
      child.once('close', resolve);
    });
    child.stdin.on('error', ignored);
    child.stdout.on('data', (chunk: Readonly<Buffer>) => {
      this.#read(chunk);
    });
    child.stderr.setEncoding('utf8').on('data', lineReporter(output));
    void this.#closed.then(() => this.onclose?.());
  }

  async start(): Promise<void> {
    await this.#spawned;
  }

  #read(chunk: Readonly<Buffer>): void {
    try {
      this.#readBuffer.append(chunk);
    } catch (error) {
      this.#observations.noteOverflow();
      this.onerror?.(new Error('The MCP server wrote more than its output may take at once', { cause: error }));
      void this.close();
      return;
    }
    this.#drain();
  }

  #drain(): void {
    for (let message = this.#next(); message !== null; message = this.#next()) {
      this.onmessage?.(message);
    }
  }

  #next(): JSONRPCMessage | null {
    while (true) {
      try {
        return this.#readBuffer.readMessage();
      } catch (error) {
        this.onerror?.(new Error('The MCP server wrote a message that is not JSON-RPC', { cause: error }));
      }
    }
  }

  send(message: unknown, options?: Readonly<SendOptions>): Promise<void> {
    this.#observations.noteSent(message, options);
    this.#child.stdin.write(`${JSON.stringify(message)}\n`);
    return Promise.resolve();
  }

  async close(): Promise<void> {
    const child = this.#child;
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    child.stdin.end();
    const stopped = await Promise.race([this.#closed.then(() => true), setTimeout(patienceMs, false)]);
    if (!stopped) {
      child.kill('SIGKILL');
      await this.#closed;
    }
  }
}
