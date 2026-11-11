import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineCapability, type Capability } from '../index.ts';
import { cancelsAt, longestCallMs } from '../read-model-testing/dead-attempt-cancels.ts';

const systemCall: Capability = defineCapability({
  type: 'system-call',
  title: 'System call',
  guide: { name: 'system-call' },
  noun: { one: 'system call', other: 'system calls' },
  describeOutput: () => 'It called a system.',
  mediaType: 'text/plain',
  parse: (source: string) => Effect.succeed(source),
  summarize: () => ({}),
  run: () => Effect.never,
  reachesOutside: true,
  mayChangeOutside: true,
  callsTools: () => true,
  longestRunOf: () => longestCallMs,
});

describe('the longest run of a version a cancel judges an attempt by, staged between today and the read model', () => {
  it('is compared at reads, read from the read model at on, and a dead attempt ends as it does today', async () => {
    const today = await cancelsAt(systemCall);

    expect([await cancelsAt(systemCall, 'reads'), await cancelsAt(systemCall, 'on')]).toEqual([
      { reads: today.reads, compared: [['matched'], ['matched']] },
      { reads: today.reads, compared: [[], []] },
    ]);
  });
});
