import { presentationOf, type Context, type KeptContent, type RecordedEvent } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { makeDefinitionPresenters } from '../index.ts';
import type { RunEvent } from '../runs/run-events.ts';
import { askedRequest, asking } from '../testing/asking.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { testRunId } from '../testing/run-facts.ts';

const { present } = presentationOf(makeDefinitionPresenters([echo]));

const ofGreet: Context = {
  runId: testRunId,
  by: 'acme-admin',
  at: '2026-10-01T09:00:01.000Z',
  definitionType: 'echo',
  definitionName: 'greet',
  definitionVersion: 2,
};

const kept: Readonly<Record<string, string>> = {
  ['a'.repeat(64)]: '{"query":"today"}',
  ['b'.repeat(64)]: '{"content":[{"type":"text","text":"{\\"rows\\":[]}"}]}',
};

const keptContent: KeptContent = (sha256) => kept[sha256];

function recorded(event: RunEvent, context: Context = ofGreet): RecordedEvent {
  return {
    id: '0b1c2d3e-4f50-5a6b-8c7d-8e9fa0b1c2d3',
    cursor: 'WyJicmFpbi9hY21lL2FscGhhLyIsIjEiXQ',
    causationId: '1c2d3e4f-5a6b-5c7d-8e9f-a0b1c2d3e4f5',
    correlationId: testRunId,
    stream: `runs/${testRunId}`,
    version: 1,
    globalPosition: 11,
    type: event.type,
    data: event.data,
    context,
    recordedAt: '2026-10-01T09:00:02.000Z',
  };
}

function presented(event: RunEvent, context: Context = ofGreet) {
  return present(recorded(event, context), {
    streamPrefix: 'playbook/acme/alpha/',
    content: keptContent,
    view: 'page',
  }).at(0);
}

describe('the presenter of the events of a run', () => {
  it('presents a start with its input as its data and the definition that ran, who and when as its metadata', () => {
    expect(presented({ type: 'run_started', data: { input: { who: 'Ada' } } })).toEqual({
      id: '0b1c2d3e-4f50-5a6b-8c7d-8e9fa0b1c2d3',
      type: 'run_started',
      summary: 'A run of the greeting “greet” started.',
      data: { input: { who: 'Ada' } },
      metadata: {
        stream: `playbook/acme/alpha/runs/${testRunId}`,
        position: 1,
        global_position: 11,
        correlation_id: testRunId,
        causation_id: '1c2d3e4f-5a6b-5c7d-8e9f-a0b1c2d3e4f5',
        at: '2026-10-01T09:00:01.000Z',
        by: 'acme-admin',
        run_id: testRunId,
        definition: { type: 'echo', name: 'greet', version: 2 },
      },
    });
  });

  it('presents an input past 2 KiB as its size', () => {
    const started = presented({ type: 'run_started', data: { input: 'x'.repeat(3000) } });

    expect(started).toMatchObject({ data: { input_bytes: 3002 } });
  });

  it('fails on a fact of a run recorded without its definition, which a presenter never hides', () => {
    const { by, at } = ofGreet;

    expect(() => presented({ type: 'run_started', data: { input: {} } }, { runId: testRunId, by, at })).toThrow(
      'definitionType',
    );
  });

  it('fails on a record that is not a fact of a run, which the ledger never holds', () => {
    const showing = { streamPrefix: '', content: keptContent, view: 'page' } as const;

    expect(() => present({ ...recorded({ type: 'run_failed', data: {} }), data: { incident: 7 } }, showing)).toThrow(
      'Expected string',
    );
  });
});

describe('the presenter of work that finishes later', () => {
  it('presents nothing for it when its capability gives no words of it, so a history goes on from the start', () => {
    const deferred: RunEvent = { type: 'run_deferred', data: { record: { run: 'r-1' } } };
    const runs = makeDefinitionPresenters([echo]).find(({ streamKind }) => streamKind === 'runs');

    expect([runs?.present(recorded(deferred), keptContent), runs?.publicNames['run_deferred']]).toEqual([
      [],
      ['run_deferred'],
    ]);
  });

  it('presents it under the public type and in the words its capability gives, and in none for a capability the server no longer has', () => {
    const deferred: RunEvent = { type: 'run_deferred', data: { record: askedRequest } };
    const runs = makeDefinitionPresenters([echo, asking]).find(({ streamKind }) => streamKind === 'runs');
    const ofAsking = { ...ofGreet, definitionType: 'asking' };

    expect([
      runs?.present(recorded(deferred, ofAsking), keptContent),
      runs?.present(recorded(deferred, { ...ofGreet, definitionType: 'gone' }), keptContent),
      runs?.publicNames['run_deferred'],
    ]).toEqual([
      [{ type: 'asking_requested', summary: 'A question waits for its answer.', data: { record: askedRequest } }],
      [],
      ['run_deferred', 'asking_requested'],
    ]);
  });
});

describe('the presenter of the answer a run took and of the facts its capability declares', () => {
  it('presents the answer a run took, with whom the caller answered for or the reply that brought it', () => {
    const reply = { id: '1699.2', sender: 'ada' };

    expect([
      presented({ type: 'request_answered', data: { answer: { choice: 'approve' } } }),
      presented({ type: 'request_answered', data: { answer: { choice: 'approve' }, claimed_for: 'ada' } }),
      presented({ type: 'request_answered', data: { answer: { choice: 'reject' }, reply } }),
    ]).toMatchObject([
      {
        type: 'request_answered',
        summary: 'The request was answered, and the run takes the answer.',
        data: { answer: { choice: 'approve' } },
      },
      { data: { answer: { choice: 'approve' }, claimed_for: 'ada' } },
      {
        summary: 'A reply from the party answered the request, and the run takes the answer.',
        data: { answer: { choice: 'reject' }, reply },
      },
    ]);
  });

  it('presents nothing of a fact no capability of the playbook declares, and a declared one in its capability’s words', () => {
    const runs = makeDefinitionPresenters([echo, asking]).find(({ streamKind }) => streamKind === 'runs');
    const stored = { ...recorded({ type: 'run_failed', data: {} }), type: 'delivery_started', data: { number: 1 } };

    expect([runs?.present(stored, keptContent), runs?.present({ ...stored, type: 'nudge_sent' }, keptContent)]).toEqual(
      [[], [{ type: 'nudge_sent', summary: 'Nudge 1 was sent.', data: { number: 1 } }]],
    );
  });
});

describe('the presenter of the end of a run', () => {
  it('presents a success with what it recorded, and a cancel asked with its reason', () => {
    expect([
      presented({ type: 'run_succeeded', data: { output: 'Hello', record: {} } }),
      presented({ type: 'run_cancel_requested', data: { kind: 'requested', reason: 'r'.repeat(2000) } }),
    ]).toMatchObject([
      { type: 'run_succeeded', summary: 'A run finished.', data: { output: 'Hello', record: {} } },
      { type: 'run_cancel_requested', data: { kind: 'requested', reason: 'r'.repeat(1024) } },
    ]);
  });

  it('presents a failure without blame', () => {
    expect(presented({ type: 'run_failed', data: { incident: 'incident-1' } })).toMatchObject({
      type: 'run_failed',
      summary: 'A run broke down because of a problem inside the server.',
      data: { incident: 'incident-1' },
    });
  });
});

describe('the presenter of a rejected run', () => {
  it('counts the issues of input it did not accept and shows the first five', () => {
    const issues = Array.from({ length: 6 }, (_, index) => ({ detail: `Issue ${index}`, pointer: `/field${index}` }));

    expect(
      presented({ type: 'run_rejected', data: { rejection: { reason: 'invalid_input', detail: 'Bad', issues } } }),
    ).toMatchObject({
      type: 'run_rejected',
      summary: 'A run did not go through: what was given does not fit what it needs.',
      data: { reason: 'invalid_input', detail: 'Bad', issue_count: 6, issues: issues.slice(0, 5) },
    });
  });

  it('shows the kind of a conflict, the kind and reason of something unavailable, and a record it kept', () => {
    const conflict = { reason: 'conflict', detail: 'The program raised an error on line 2: stop' } as const;
    const unavailable = { reason: 'unavailable', detail: 'No model' } as const;
    const record = { usage: { total: 320 }, duration_ms: 41 };

    expect([
      presented({ type: 'run_rejected', data: { rejection: { ...conflict, kind: 'unworkable' } } }),
      presented({ type: 'run_rejected', data: { rejection: conflict } }),
      presented({
        type: 'run_rejected',
        data: { rejection: { ...unavailable, kind: 'model_not_offered', because: 'model_not_allowed' } },
      }),
      presented({ type: 'run_rejected', data: { rejection: unavailable, record } }),
      presented({
        type: 'run_rejected',
        data: { rejection: { reason: 'cancelled', kind: 'requested', detail: '😀'.repeat(1000) } },
      }),
    ]).toMatchObject([
      {
        summary: 'A run did not go through: it cannot work as it is written.',
        data: { ...conflict, kind: 'unworkable' },
      },
      { data: conflict },
      {
        summary:
          'A run did not go through: this server does not offer the model named, because it is not among the models whoever runs the server allows.',
        data: { ...unavailable, kind: 'model_not_offered', because: 'model_not_allowed' },
      },
      { data: { ...unavailable, record } },
      { data: { reason: 'cancelled', kind: 'requested', detail: '😀'.repeat(256) } },
    ]);
  });
});

const sent = {
  number: 3,
  call_id: 'toolu_03',
  server: 'graph',
  tool: 'get_lifelogs',
  arguments_bytes: 17,
  arguments_sha256: 'a'.repeat(64),
};

const answer = {
  number: 3,
  is_error: false,
  result_bytes: 42,
  result_sha256: 'b'.repeat(64),
  duration_ms: 120,
  jsonrpc_id: 7,
};

describe('the presenter of the start of a tool call', () => {
  it('presents a call by its number, server, tool, its arguments, and their size and digest', () => {
    expect(presented({ type: 'tool_call_started', data: sent })).toMatchObject({
      type: 'tool_call_started',
      summary: 'A run made tool call 3, to the get lifelogs tool of graph.',
      data: { ...sent, arguments: { query: 'today' } },
    });
  });

  it('shows that its server marks the tool read-only, and keeps nothing of a name but letters and digits in words', () => {
    expect([
      presented({ type: 'tool_call_started', data: { ...sent, read_only: true } }),
      presented({ type: 'tool_call_started', data: { ...sent, tool: 'files/read.v2', server: 'graph-eu' } }),
    ]).toMatchObject([
      { data: { read_only: true } },
      { summary: 'A run made tool call 3, to the files read v2 tool of graph eu.' },
    ]);
  });

  it('shows no arguments for a call whose server keeps no content, since its fact names no digest', () => {
    const { arguments_sha256: _digest, ...unkept } = sent;

    expect(presented({ type: 'tool_call_started', data: unkept })?.data).not.toHaveProperty('arguments');
  });
});

describe('the presenter of the end of a tool call', () => {
  it('presents an answer, and an answer with an error of the tool, in plain words with the answer it kept', () => {
    expect([
      presented({ type: 'tool_call_answered', data: { ...answer, server_request_id: 'req-9' } }),
      presented({ type: 'tool_call_answered', data: { ...answer, is_error: true } }),
    ]).toMatchObject([
      {
        type: 'tool_call_answered',
        summary: 'Tool call 3 answered.',
        data: { ...answer, server_request_id: 'req-9', answer: { rows: [] } },
      },
      { summary: 'Tool call 3 answered with an error of its own.' },
    ]);
  });

  it.each([
    ['arguments_refused', 'Tool call 3 was refused by its server, which did not take its arguments.'],
    ['server_failure', 'Tool call 3 failed at its server.'],
    ['timed_out', 'Tool call 3 took too long, so it was given up.'],
    ['cancelled', 'Tool call 3 was cancelled when the run ended.'],
  ] as const)('presents a call that failed as %s in plain words', (because, summary) => {
    expect(
      presented({ type: 'tool_call_failed', data: { number: 3, because, duration_ms: 5, jsonrpc_id: 'j-1' } }),
    ).toMatchObject({ type: 'tool_call_failed', summary, data: { because, jsonrpc_id: 'j-1' } });
  });
});
