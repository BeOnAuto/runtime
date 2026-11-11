import { describe, expect, it } from 'vitest';

import { holderUnlessStopped, keysUnlessStopped } from './stopping-runtime.ts';

const stopped = { status: 'cancelled' } as const;

const signing = { connection: '019a4000-0000-7000-8000-00000000a991', keys: [] };

describe('a delivery that reaches a server as it stops', () => {
  it('finds no keys once the server stopped reading them, so the door refuses it as one it cannot prove', () => {
    expect([keysUnlessStopped(stopped), keysUnlessStopped(signing)]).toEqual([undefined, signing]);
  });

  it('finds its id held by nothing it was signed for once the server stopped keeping ids, so it is refused alike', () => {
    expect([holderUnlessStopped(stopped), holderUnlessStopped('ops/019a4131')]).toEqual(['', 'ops/019a4131']);
  });
});
