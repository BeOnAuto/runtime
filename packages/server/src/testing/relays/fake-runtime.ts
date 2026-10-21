import { SdkErrorCode, SdkHttpError } from '@modelcontextprotocol/client';
import {
  isJSONRPCRequest,
  parseJSONRPCMessage,
  type RequestId,
  type Transport,
  type TransportSendOptions,
} from '@modelcontextprotocol/server';
import { serverStopping, stoppedWords } from '@on.auto/api';
import { Function } from 'effect';

import type { Heard } from '../../runtime-recovery/runtime-connection.ts';

export type Turn =
  | 'answers'
  | 'answers bare'
  | 'notifies'
  | 'errs'
  | 'refuses'
  | 'turns away'
  | 'turns away with a problem'
  | 'turns away while it stops'
  | 'answers that it stopped'
  | 'ends unanswered'
  | 'cuts'
  | 'stays silent'
  | 'streams';

export interface FakeRuntime {
  readonly open: (heard: Heard) => Transport;
  readonly sent: () => readonly unknown[];
  readonly aborted: () => readonly RequestId[];
  readonly beat: (id: RequestId) => void;
  readonly answer: (id: RequestId) => void;
  readonly negotiated: () => readonly string[];
  readonly closed: () => boolean;
  readonly fails: (error: Readonly<Error>) => void;
}

export const refusedAtConnect = new TypeError('fetch failed', {
  cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5555'), { code: 'ECONNREFUSED', syscall: 'connect' }),
});

export const cutOffMidAnswer = new TypeError('terminated', {
  cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }),
});

export function turnedAwayWith(status: number, text?: string): SdkHttpError {
  return new SdkHttpError(SdkErrorCode.ClientHttpNotImplemented, `Error POSTing to endpoint: ${status}`, {
    status,
    text,
  });
}

function resultOf(method: string): Readonly<Record<string, unknown>> {
  return method === 'initialize' ? { protocolVersion: '2025-11-25', capabilities: {} } : { tools: [] };
}

interface Played {
  readonly id: RequestId;
  readonly method: string;
  readonly options: Readonly<TransportSendOptions> | undefined;
}

type Said = (message: Readonly<Record<string, unknown>>) => void;

interface Playing {
  readonly heard: Heard;
  readonly said: Said;
  readonly streaming: (id: RequestId, method: string) => void;
}

function heardAndSaid(
  { heard, said }: Playing,
  id: RequestId,
  ...messages: readonly Readonly<Record<string, unknown>>[]
): Promise<void> {
  heard(id);
  for (const message of messages) {
    said(message);
  }
  return Promise.resolve();
}

function turnsOf(playing: Playing): Readonly<Record<Turn, (played: Played) => Promise<void>>> {
  return {
    answers: ({ id, method }) => heardAndSaid(playing, id, { jsonrpc: '2.0', id, result: resultOf(method) }),
    'answers bare': ({ id }) => heardAndSaid(playing, id, { jsonrpc: '2.0', id, result: {} }),
    notifies: ({ id, method }) =>
      heardAndSaid(
        playing,
        id,
        { jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: id, progress: 1 } },
        { jsonrpc: '2.0', id, result: resultOf(method) },
      ),
    errs: ({ id }) =>
      heardAndSaid(playing, id, { jsonrpc: '2.0', id, error: { code: -32_602, message: 'No such tool' } }),
    refuses: () => Promise.reject(refusedAtConnect),
    'turns away': () => Promise.reject(turnedAwayWith(401)),
    'turns away while it stops': () => Promise.reject(turnedAwayWith(503, JSON.stringify(serverStopping))),
    'answers that it stopped': ({ id }) =>
      heardAndSaid(playing, id, { jsonrpc: '2.0', id, error: { code: -32_603, message: stoppedWords } }),
    'turns away with a problem': () =>
      Promise.reject(
        turnedAwayWith(413, JSON.stringify({ title: 'Content too large', detail: 'The body is too large' })),
      ),
    'ends unanswered': ({ id, options }) => {
      queueMicrotask(() => options?.onRequestStreamEnd?.());
      return heardAndSaid(playing, id);
    },
    cuts: () => Promise.reject(cutOffMidAnswer),
    'stays silent': () => new Promise(Function.constVoid),
    streams: ({ id, method }) => {
      playing.streaming(id, method);
      return heardAndSaid(playing, id);
    },
  };
}

interface Ends {
  closed: boolean;
  heard: Heard;
}

interface Recording {
  readonly heard: Heard;
  readonly sent: (message: unknown) => void;
  readonly aborted: (id: RequestId) => void;
  readonly streaming: (id: RequestId, method: string) => void;
  readonly closing: () => void;
}

function playingOn(transport: Readonly<Transport>, recording: Recording): Playing {
  return {
    heard: recording.heard,
    said: (message) => {
      queueMicrotask(() => transport.onmessage?.(parseJSONRPCMessage(message)));
    },
    streaming: recording.streaming,
  };
}

function transportPlaying(turns: readonly Turn[], recording: Recording): Transport {
  const left = [...turns];
  const transport: Transport = {
    start: () => Promise.resolve(),
    send: (message: unknown, options?: Readonly<TransportSendOptions>) => {
      recording.sent(message);
      const turn = left.shift() ?? 'answers';
      if (!isJSONRPCRequest(message)) {
        return turn === 'refuses' ? Promise.reject(refusedAtConnect) : Promise.resolve();
      }
      options?.requestSignal?.addEventListener('abort', () => {
        recording.aborted(message.id);
      });
      return turnsOf(playingOn(transport, recording))[turn]({ id: message.id, method: message.method, options });
    },
    close: () => {
      recording.closing();
      return Promise.resolve();
    },
  };
  return transport;
}

export function fakeRuntime(turns: readonly Turn[] = [], negotiates = true): FakeRuntime {
  const sent: unknown[] = [];
  const negotiated: string[] = [];
  const aborted: RequestId[] = [];
  const streams = new Map<RequestId, string>();
  const ends: Ends = { closed: false, heard: Function.constVoid };
  const recording: Recording = {
    heard: (id) => {
      ends.heard(id);
    },
    sent: (message) => {
      sent.push(message);
    },
    aborted: (id) => {
      aborted.push(id);
    },
    streaming: (id, method) => {
      streams.set(id, method);
    },
    closing: () => {
      ends.closed = true;
    },
  };
  const played = transportPlaying(turns, recording);
  const transport: Transport = negotiates
    ? Object.assign(played, {
        setProtocolVersion: (version: string) => {
          negotiated.push(version);
        },
      })
    : played;
  const playing = playingOn(transport, recording);
  return {
    open: (heard) => {
      ends.heard = heard;
      return transport;
    },
    sent: () => [...sent],
    aborted: () => [...aborted],
    beat: recording.heard,
    answer: (id) => {
      playing.said({ jsonrpc: '2.0', id, result: resultOf(String(streams.get(id))) });
    },
    negotiated: () => [...negotiated],
    closed: () => ends.closed,
    fails: (error) => {
      transport.onerror?.(error);
    },
  };
}
