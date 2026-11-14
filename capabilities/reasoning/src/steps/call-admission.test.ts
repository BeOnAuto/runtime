import { actingCallsCount } from '@on.auto/tool-servers/policy';
import { describe, expect, it } from 'vitest';

import { noAsking } from './asked-calls.ts';
import { admittedAgain } from './call-admission.ts';

describe('a call its run sent of a tool it no longer offers, admitted again', () => {
  it('keeps the answer its facts gave it, and counts it once by the mark its fact records', () => {
    const asked = [{ callId: 'call-1', tool: 'graph__search', input: { query: 'acme' } }];
    const answer = { type: 'tool-result', toolCallId: 'call-1', toolName: 'graph__search', output: 'Found 2 rows.' };
    const again = admittedAgain(
      { ...noAsking, asked, started: new Map([['call-1', false]]), results: new Map([['call-1', answer]]) },
      { offered: new Map(), count: actingCallsCount },
    );

    expect([again.tally.counted, again.asking.results.get('call-1'), again.asking.refused.size]).toEqual([
      1,
      answer,
      0,
    ]);
  });
});
