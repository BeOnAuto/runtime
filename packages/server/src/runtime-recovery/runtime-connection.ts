import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { RequestId, Transport } from '@modelcontextprotocol/server';
import { hearingFetch } from '@on.auto/api';
import { Function, type Effect } from 'effect';

import { runtimeAddressOf } from '../local-runtime/runtime-probe.ts';
import { pingThrough, type PingOutcome } from './runtime-ping.ts';

export type Heard = (id: RequestId) => void;

function mcpOf(port: number): URL {
  return new URL(`${runtimeAddressOf(port)}/mcp`);
}

export function runtimeConnectionTo(port: number, heard: Heard): Transport {
  return new StreamableHTTPClientTransport(mcpOf(port), {
    fetch: hearingFetch(fetch, (asked) => {
      heard(asked);
      return {
        piece: () => {
          heard(asked);
        },
        ended: Function.constVoid,
      };
    }),
  });
}

export function pingOf(port: number): Effect.Effect<PingOutcome> {
  return pingThrough(() => new StreamableHTTPClientTransport(mcpOf(port)));
}
