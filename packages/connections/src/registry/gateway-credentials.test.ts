import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { gatewayIssuer } from '../testing/gateway-facts.ts';
import { ConnectionEventSchema } from './connection-events.ts';

const decoded = Schema.decodeUnknownResult(ConnectionEventSchema);

function addedWith(provider: string | null, credential: Readonly<Record<string, unknown>>) {
  return {
    type: 'connection_added',
    data: {
      connection: 'connection-1',
      name: 'messages',
      server_type: 'openapi',
      provider,
      placeholders: null,
      entry: { document: 'https://gateway.messages.example.com/openapi.json' },
      credential,
      says: {},
      added_by: { id: 'person:ada', name: 'Ada Lovelace' },
    },
    context: { by: 'person:ada', at: '2026-10-15T14:00:00.000Z' },
  };
}

describe('the credential of a connection through a gateway', () => {
  it('is recorded only from a provider’s entry, never given by hand, and places its key under a security scheme', () => {
    const throughIt = {
      kind: 'authorization',
      issuer: gatewayIssuer,
      client_source: 'gateway',
      in: 'security',
      name: 'key',
    };
    const outcomes = [
      addedWith('messages', throughIt),
      addedWith(null, throughIt),
      addedWith('messages', { ...throughIt, in: 'header' }),
      addedWith('messages', { kind: 'authorization', issuer: gatewayIssuer, client_source: 'gateway' }),
      addedWith('messages', { ...throughIt, clients: ['registered'] }),
      addedWith('messages', { ...throughIt, scheme: 'Bearer' }),
    ].map((fact: unknown) => Result.isSuccess(decoded(fact)));
    const byHand = Result.match(decoded(addedWith(null, throughIt)), { onSuccess: () => '', onFailure: String });

    expect(outcomes).toEqual([true, false, false, false, false, false]);
    expect(byHand).toContain(
      "Expected a provider, whose entry alone names the gateway a connection's consent is made through",
    );
  });
});
