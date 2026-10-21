import { randomUUID } from 'node:crypto';

import { SdkHttpError } from '@modelcontextprotocol/client';
import { isJSONRPCResponse, parseJSONRPCMessage, type Transport } from '@modelcontextprotocol/server';
import { Effect, Function } from 'effect';

import { lossOf } from './runtime-losses.ts';

export type PingOutcome = 'answers' | 'refused' | 'asks for a credential' | 'not a runtime' | 'silent';

const statusesAskingForACredential: ReadonlySet<number> = new Set([401, 403]);

function outcomeOf(failure: unknown): PingOutcome {
  if (lossOf(failure) === 'refused') {
    return 'refused';
  }
  return failure instanceof SdkHttpError && statusesAskingForACredential.has(failure.status)
    ? 'asks for a credential'
    : 'not a runtime';
}

function pingedOver(transport: Readonly<Transport>): Effect.Effect<PingOutcome> {
  return Effect.callback<PingOutcome>((resume) => {
    const id = `ping-${randomUUID()}`;
    Object.assign(transport, {
      onmessage: (message: unknown) => {
        if (isJSONRPCResponse(message) && message.id === id) {
          resume(Effect.succeed('answers'));
        }
      },
      onerror: Function.constVoid,
    });
    transport
      .start()
      .then(() => transport.send(parseJSONRPCMessage({ jsonrpc: '2.0', id, method: 'ping' })))
      .catch((failure: unknown) => {
        resume(Effect.succeed(outcomeOf(failure)));
      });
  });
}

export function pingThrough(open: () => Transport): Effect.Effect<PingOutcome> {
  return Effect.acquireUseRelease(Effect.sync(open), pingedOver, (transport: Readonly<Transport>) =>
    Effect.promise(() => transport.close()),
  );
}
