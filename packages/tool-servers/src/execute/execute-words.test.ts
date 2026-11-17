import { unsuccessfulWords, type RejectionBecause } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { toolBounds } from '../bounds/call-bounds.ts';
import { defineExecuteConnection } from '../index.ts';

const { registration } = defineExecuteConnection({
  open: () => Effect.die(new Error('A test of the words opens nothing')),
  configured: true,
});

const words = registration.plainLanguage;

const asked = { server: 'graph', tool: 'search' };

const answer = {
  call_id: '0199b7e2-4c1d-7a3e-8f5b-6d2c1e0f9a8b',
  server: 'graph',
  tool: 'search',
  outcome: 'result',
  text: 'Found 2 rows.',
  result_bytes: 1204,
  duration_ms: 312,
  called_at: '2026-10-08T09:00:00.000Z',
};

function failed(text: string): string | undefined {
  return words?.outcome({ ...answer, outcome: 'server_failure', text, result_bytes: null }, asked);
}

function distinct(texts: readonly (string | undefined)[]): number {
  return new Set(texts).size;
}

describe('the plain words of execute', () => {
  it('say which tool of which server it tried to call, or what it tried when the input does not hold', () => {
    const [named, unnamed] = [words?.attempt(asked), words?.attempt({ server: 'Graph/', tool: 'search' })];

    expect([named?.includes('graph'), unnamed?.includes('Graph/')]).toEqual([true, false]);
  });

  it('say what the tool answered, how long it took and how much, with each outcome its own words', () => {
    const outcomes = [
      words?.outcome(answer, asked),
      words?.outcome({ ...answer, result_bytes: null }, asked),
      words?.outcome({ ...answer, outcome: 'too_large', result_bytes: null }, asked),
      words?.outcome({ ...answer, outcome: 'tool_error', text: 'The field salary is denied.' }, asked),
      words?.outcome({ ...answer, outcome: 'timed_out', result_bytes: null }, asked),
    ];

    expect(['312 ms', '1,204'].map((part) => outcomes[0]?.includes(part))).toEqual([true, true]);
    expect(outcomes[3]).not.toContain('salary');
    expect(outcomes[4]).toContain(String(toolBounds.callMs / 1000));
    expect(distinct(outcomes)).toBe(5);
  });

  it('say what the server said when it failed, ending its words once, whether the server ended them or not', () => {
    const [unended, ended] = [
      failed('The tool server graph failed: The tool server answered HTTP 503'),
      failed('The tool server graph failed: The tool server answered HTTP 503.'),
    ];

    expect(unended).toContain('HTTP 503');
    expect(unended).not.toContain('503..');
    expect(ended).toBe(unended);
  });
});

const notOffered = (because: RejectionBecause) =>
  ({ status: 'rejected', reason: 'unavailable', detail: 'x', kind: 'tool_not_offered', because }) as const;

describe('the plain words of a call refused a tool it is not offered', () => {
  it('end with the remedy execute gives for a tool server not set up for the playbook', () => {
    const attempt = 'call the search tool of wiki';
    const [remedied, plain] = [
      unsuccessfulWords(attempt, 'command', notOffered('tool_server_not_configured'), { remedies: words?.remedies }),
      unsuccessfulWords(attempt, 'command', notOffered('tool_server_not_configured'), {}),
    ];

    expect(remedied).not.toBe(plain);
    expect(remedied.startsWith(plain.slice(0, plain.indexOf('.')))).toBe(true);
  });
});
