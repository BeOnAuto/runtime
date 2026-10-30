import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { PublicEventSchema, WholeEventSchema, mostPublicEventDataBytes } from '../index.ts';

const decodeEvent = Schema.decodeUnknownResult(PublicEventSchema);

const decodeWholeEvent = Schema.decodeUnknownResult(WholeEventSchema);

function eventWithData(bytes: number) {
  const free = bytes - JSON.stringify({ text: '' }).length;
  return {
    id: '0b1c2d3e-4f50-5a6b-8c7d-8e9fa0b1c2d3',
    type: 'run_started',
    summary: 'A run of the summary reasoning started',
    data: { text: `${'é'.repeat(Math.floor(free / 2))}${'a'.repeat(free % 2)}` },
    metadata: {
      stream: 'playbook/acme/sales/runs/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
      position: 1,
      global_position: 42,
      correlation_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
      causation_id: null,
      at: '2026-10-05T09:00:00.000Z',
      by: 'playbook:sales',
      run_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
      definition: { type: 'reasoning', name: 'summary', version: 2 },
    },
  };
}

describe('a public event', () => {
  it('carries data of up to 4 KiB as JSON in UTF-8', () => {
    const largest = eventWithData(mostPublicEventDataBytes);

    expect(decodeEvent(largest)).toEqual(Result.succeed(largest));
  });

  it('is refused with data of more than 4 KiB', () => {
    expect(Result.isFailure(decodeEvent(eventWithData(mostPublicEventDataBytes + 1)))).toBe(true);
  });

  it('read whole carries data of any size', () => {
    const large = eventWithData(mostPublicEventDataBytes * 4);

    expect(decodeWholeEvent(large)).toEqual(Result.succeed(large));
  });
});
