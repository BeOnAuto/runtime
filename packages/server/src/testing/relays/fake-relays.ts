import { SdkErrorCode, SdkHttpError } from '@modelcontextprotocol/client';
import { InMemoryTransport, parseJSONRPCMessage, type Transport } from '@modelcontextprotocol/server';

import { relay, type Timer } from '../../local-runtime/mcp-relay.ts';

export const listTools = parseJSONRPCMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });

export const callATool = parseJSONRPCMessage({
  jsonrpc: '2.0',
  id: 3,
  method: 'tools/call',
  params: { name: 'run_definition', arguments: {} },
});

export const initialize = parseJSONRPCMessage({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'agent', version: '1.0.0' } },
});

export const initialized = parseJSONRPCMessage({ jsonrpc: '2.0', method: 'notifications/initialized' });

export type Reply = (message: unknown) => unknown;

export function idOf(message: unknown): unknown {
  return typeof message === 'object' && message !== null && 'id' in message ? message.id : undefined;
}

const echoTools: Reply = (message) => ({ jsonrpc: '2.0', id: idOf(message), result: { tools: [] } });

export type Turn = Readonly<Error> | 'hangs' | 'drops the answer' | 'resolves late';

export interface FakeRuntimeOptions {
  readonly reply?: Reply;
  readonly turns?: readonly Turn[];
  readonly negotiates?: boolean;
}

export interface FakeRuntime {
  readonly transport: Transport;
  readonly received: unknown[];
  readonly negotiated: string[];
  readonly closed: () => boolean;
  readonly sends: () => number;
  readonly resolveLate: () => void;
}

function hungUntilGivenUp(signal: Readonly<AbortSignal> | undefined): Promise<void> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => {
      reject(new DOMException('This operation was aborted', 'AbortError'));
    });
  });
}

interface SendOptions {
  readonly requestSignal?: Readonly<AbortSignal> | undefined;
  readonly onRequestStreamEnd?: (() => void) | undefined;
}

interface Turning {
  readonly answered: (message: unknown) => Promise<void>;
  readonly late: Promise<void>;
}

function streamEndedFor(options: SendOptions | undefined): void {
  queueMicrotask(() => {
    options?.onRequestStreamEnd?.();
  });
}

function turned(turn: Turn, message: unknown, options: SendOptions | undefined, turning: Turning): Promise<void> {
  if (turn === 'hangs') {
    return hungUntilGivenUp(options?.requestSignal);
  }
  if (turn === 'resolves late') {
    return turning.late.then(() => turning.answered(message));
  }
  if (turn === 'drops the answer') {
    streamEndedFor(options);
    return Promise.resolve();
  }
  return Promise.reject(turn);
}

function negotiating(negotiates: boolean, negotiate: (version: string) => void): Partial<Transport> {
  return negotiates ? { setProtocolVersion: negotiate } : {};
}

export function fakeRuntime({
  reply = echoTools,
  turns = [],
  negotiates = true,
}: FakeRuntimeOptions = {}): FakeRuntime {
  const received: unknown[] = [];
  const negotiated: string[] = [];
  const coming = [...turns];
  const late = Promise.withResolvers<void>();
  const state = { closed: false, sends: 0 };
  const answered = (message: unknown): Promise<void> => {
    received.push(message);
    const answer = reply(message);
    if (answer !== undefined) {
      queueMicrotask(() => transport.onmessage?.(parseJSONRPCMessage(answer)));
    }
    return Promise.resolve();
  };
  const transport: Transport = {
    start: () => Promise.resolve(),
    send: (message: unknown, options?: SendOptions) => {
      state.sends += 1;
      const turn = coming.shift();
      if (turn !== undefined) {
        return turned(turn, message, options, { answered, late: late.promise });
      }
      const sent = answered(message);
      streamEndedFor(options);
      return sent;
    },
    close: () => {
      state.closed = true;
      return Promise.resolve();
    },
    ...negotiating(negotiates, (version) => {
      negotiated.push(version);
    }),
  };
  return {
    transport,
    received,
    negotiated,
    closed: () => state.closed,
    sends: () => state.sends,
    resolveLate: () => {
      late.resolve();
    },
  };
}

export function fakeRuntimeEnd(options: FakeRuntimeOptions = {}): () => Transport {
  const { transport } = fakeRuntime(options);
  return () => transport;
}

export const refusedAtConnect = new TypeError('fetch failed', {
  cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5555'), { code: 'ECONNREFUSED', syscall: 'connect' }),
});

export function answeredWithStatus(status: number): SdkHttpError {
  return new SdkHttpError(SdkErrorCode.ClientHttpNotImplemented, `Error POSTing to endpoint: ${status}`, { status });
}

export const cutOffMidAnswer = new TypeError('terminated', {
  cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }),
});

export const droppedAfterTheRequest = new TypeError('fetch failed', {
  cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }),
});

export interface Timers {
  readonly timer: Timer;
  readonly fire: (milliseconds: number) => void;
  readonly armed: (milliseconds: number) => number;
}

interface Armed {
  readonly milliseconds: number;
  readonly fires: () => void;
}

function fakeTimers(): Timers {
  const armed = new Set<Armed>();
  const due = (milliseconds: number): readonly Armed[] =>
    [...armed].filter((timer) => timer.milliseconds === milliseconds);
  return {
    timer: (milliseconds, fires) => {
      const timer = { milliseconds, fires };
      armed.add(timer);
      return () => {
        armed.delete(timer);
      };
    },
    fire: (milliseconds) => {
      for (const timer of due(milliseconds)) {
        armed.delete(timer);
        timer.fires();
      }
    },
    armed: (milliseconds) => due(milliseconds).length,
  };
}

export interface Recovery {
  readonly problem?: string;
  readonly answering?: readonly boolean[];
  readonly answeringWith?: () => Promise<boolean>;
  readonly recover?: () => Promise<string | undefined>;
}

export interface Relayed {
  readonly agent: Transport;
  readonly relayEnd: Transport;
  readonly reported: string[];
  readonly recovered: () => number;
  readonly timers: Timers;
  readonly ended: Promise<void>;
  readonly next: () => Promise<unknown>;
}

function answersOf(agent: Readonly<Transport>): () => Promise<unknown> {
  const answers: unknown[] = [];
  const waiting: ((message: unknown) => void)[] = [];
  Object.assign(agent, {
    onmessage: (message: unknown) => {
      const waiter = waiting.shift();
      if (waiter === undefined) {
        answers.push(message);
      } else {
        waiter(message);
      }
    },
  });
  return () =>
    answers.length > 0
      ? Promise.resolve(answers.shift())
      : new Promise((resolve) => {
          waiting.push(resolve);
        });
}

export async function relayed(runtimeEnd: () => Transport, recovery: Recovery = {}): Promise<Relayed> {
  const [agent, relayEnd] = InMemoryTransport.createLinkedPair();
  const reported: string[] = [];
  const answering = [...(recovery.answering ?? [])];
  const timers = fakeTimers();
  const next = answersOf(agent);
  const counted = { recoveries: 0 };
  const ended = relay({
    agent: () => relayEnd,
    runtime: runtimeEnd,
    recover: () => {
      counted.recoveries += 1;
      return recovery.recover?.() ?? Promise.resolve(recovery.problem);
    },
    answering: recovery.answeringWith ?? (() => Promise.resolve(answering.shift() ?? true)),
    timer: timers.timer,
    report: (line) => {
      reported.push(line);
    },
  });
  await agent.start();
  return { agent, relayEnd, reported, recovered: () => counted.recoveries, timers, ended, next };
}
