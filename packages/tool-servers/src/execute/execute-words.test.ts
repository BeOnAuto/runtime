import { unsuccessfulWords, type RejectionBecause } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineExecute } from '../index.ts';

const { registration } = defineExecute({
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

describe('the plain words of execute', () => {
  it('say which tool of which server it tried to call, or what it tried when the input does not hold', () => {
    expect(words?.attempt({ server: 'graph', tool: 'search' })).toBe('call the search tool of graph');
    expect(words?.attempt({ server: 'Graph/', tool: 'search' })).toBe('call a tool of a tool server');
  });

  it('say what the tool answered, how long it took and how much, and where the model’s view of it is', () => {
    expect(words?.outcome(answer, asked)).toBe(
      "The search tool of graph answered in 312 ms with 1,204 bytes; what a reasoning function's model would see is in the details.",
    );
    expect(words?.outcome({ ...answer, result_bytes: null }, asked)).toBe(
      "The search tool of graph answered in 312 ms with nothing; what a reasoning function's model would see is in the details.",
    );
  });

  it('say that the tool answered more than one call may take', () => {
    expect(words?.outcome({ ...answer, outcome: 'too_large', result_bytes: null }, asked)).toBe(
      'The search tool of graph answered more than one call may take, so its answer was not read; ask it for less, a page at a time.',
    );
  });

  it('say that the tool answered an error, that its server failed, or that it did not answer in time', () => {
    const toolError = { ...answer, outcome: 'tool_error', text: 'The field salary is denied.' };
    const serverFailure = {
      ...answer,
      outcome: 'server_failure',
      text: 'The tool server graph failed: The tool server answered HTTP 503',
      result_bytes: null,
    };
    const timedOut = { ...answer, outcome: 'timed_out', result_bytes: null };

    expect(words?.outcome(toolError, asked)).toBe(
      "The search tool of graph answered an error, as a run's model would see it; the details show what it said.",
    );
    expect(words?.outcome(serverFailure, asked)).toBe(
      'The tool server “graph” failed to answer the call: The tool server answered HTTP 503. It may or may not have received the call.',
    );
    expect(words?.outcome(timedOut, asked)).toBe(
      'The tool server “graph” did not answer the call within 30 seconds; it may still have received it.',
    );
  });

  it('end the words of a failure once, whether the server ended them or not', () => {
    const failed = { ...answer, outcome: 'server_failure', text: 'The tool server graph failed: Gone away.' };

    expect(words?.outcome(failed, asked)).toBe(
      'The tool server “graph” failed to answer the call: Gone away. It may or may not have received the call.',
    );
  });
});

const notOffered = (because: RejectionBecause) =>
  ({ status: 'rejected', reason: 'unavailable', detail: 'x', kind: 'tool_not_offered', because }) as const;

describe('the plain words of a call refused a tool it is not offered', () => {
  it('say why and what to do in one message for a tool server not set up for the playbook', () => {
    expect(
      unsuccessfulWords(
        'call the search tool of wiki',
        'command',
        notOffered('tool_server_not_configured'),
        words?.remedies,
      ),
    ).toBe(
      'Could not call the search tool of wiki: this server does not offer a tool it names, because whoever runs the server has not set up a tool server of that name for this playbook. Nothing was changed. This can be put right on your side: search shows the tool servers this playbook may use, so naming one of those can work.',
    );
  });
});
