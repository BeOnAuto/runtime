import { Redacted } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  destinationUnlessStopped,
  holderUnlessStopped,
  keysUnlessStopped,
  secretsUnlessStopped,
} from './stopping-runtime.ts';

const stopped = { status: 'cancelled' } as const;

const signing = { connection: '019a4000-0000-7000-8000-00000000a991', keys: [] };

describe('a delivery that reaches a server as it stops', () => {
  it('finds no keys once the server stopped reading them, so the door refuses it as one it cannot prove', () => {
    expect([keysUnlessStopped(stopped), keysUnlessStopped(signing)]).toEqual([undefined, signing]);
  });

  it('finds its id held by nothing it was signed for once the server stopped keeping ids, so it is refused alike', () => {
    expect([holderUnlessStopped(stopped), holderUnlessStopped('ops/019a4131')]).toEqual(['', 'ops/019a4131']);
  });

  it('finds no destination and no secret at an events address once the server stopped reading them, so the door refuses it alike', () => {
    const destination = { type: 'webhook', filter: { when: { '$request.header.X-Event': ['comment'] } } } as const;
    const secrets = [{ secret: Redacted.make('whsec_held'), subscription: { topic: 'C0123', id: 'hook-7' } }];

    expect([destinationUnlessStopped(stopped), destinationUnlessStopped(destination)]).toEqual([
      undefined,
      destination,
    ]);
    expect([secretsUnlessStopped(stopped), secretsUnlessStopped(secrets)]).toEqual([[], secrets]);
  });
});
