import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { CallJournal } from '../calls/recorded-calls.ts';
import { recordingCallJournal } from '../testing/index.ts';
import { calledOnce, echoCall, oneCallAccess, oneCallServer, unopenedWith } from '../testing/one-calls.ts';

const callId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const aDigest: unknown = expect.stringMatching(/^[0-9a-f]{64}$/u);

const aNumber: unknown = expect.any(Number);

function seenWhenStarted(journal: CallJournal, onStart: () => void): CallJournal {
  return { ...journal, started: (fact) => Effect.sync(onStart).pipe(Effect.andThen(journal.started(fact))) };
}

describe('a call recorded on its run', () => {
  it('records its start under the id it is given once its tool is listed and before it is sent, and its answer after', async () => {
    const fake = await oneCallServer();
    const journal = recordingCallJournal();
    const receivedAtTheStart: number[] = [];
    const runCall = {
      callId,
      journal: seenWhenStarted(journal, () => {
        receivedAtTheStart.push(fake.received().length);
      }),
    };

    const called = await calledOnce(oneCallAccess(fake.url), {}, runCall);

    expect(receivedAtTheStart).toEqual([0]);
    expect(journal.facts()).toEqual([
      {
        number: 1,
        type: 'tool_call_started',
        data: {
          call_id: callId,
          server: 'graph',
          tool: 'echo',
          arguments_bytes: 48,
          arguments_sha256: aDigest,
        },
      },
      {
        number: 1,
        type: 'tool_call_answered',
        data: {
          is_error: false,
          result_bytes: 95,
          result_sha256: aDigest,
          jsonrpc_id: aNumber,
          duration_ms: aNumber,
        },
      },
    ]);
    expect(called).toMatchObject({ kind: 'answered', outcome: 'result' });
  });
});

describe('a call its run records nothing of', () => {
  it('records nothing for a tool that is not offered or not listed, or a server that cannot be reached', async () => {
    const fake = await oneCallServer();
    const journal = recordingCallJournal();
    const runCall = { callId, journal };
    const unreachable = await oneCallServer();
    await unreachable.close();

    expect([
      await calledOnce(oneCallAccess(fake.url), { reference: { server: 'graph', tool: 'environment' } }, runCall),
      await calledOnce(oneCallAccess(fake.url), { reference: { server: 'graph', tool: 'gone' } }, runCall),
      await calledOnce(oneCallAccess(unreachable.url), {}, runCall),
    ]).toEqual([
      unopenedWith(
        'tool_not_offered',
        'tool_not_allowed',
        'The operator of this server does not allow graph/environment',
      ),
      unopenedWith('tool_not_offered', 'tool_not_listed', 'The tool server graph does not list the tool gone'),
      unopenedWith(
        'tool_server_failed',
        'unreachable',
        'The tool server graph could not be used: The tool server could not be reached',
      ),
    ]);
    expect([journal.facts(), fake.received()]).toEqual([[], []]);
  });

  it('dies, sending nothing, when its run records no start, and lets its session go', async () => {
    const fake = await oneCallServer();
    const journal = recordingCallJournal();
    journal.refuseStartsFromNowOn();

    await expect(calledOnce(oneCallAccess(fake.url), {}, { callId, journal })).rejects.toThrow(
      'The start of the call could not be recorded on its run, so the call was not sent',
    );
    expect([fake.received(), fake.openSessions(), fake.endedSessions()]).toEqual([[], 0, 1]);
  });
});

describe('a call that needs its tool marked reads', () => {
  it('is sent and recorded when its server marks the tool reads', async () => {
    const fake = await oneCallServer();
    const journal = recordingCallJournal();
    const searching = { reference: { server: 'graph', tool: 'search' }, input: { query: 'acme' } };

    const called = await calledOnce(
      oneCallAccess(fake.url),
      { ...searching, requiredMark: 'reads' },
      { callId, journal },
    );

    expect(called).toMatchObject({ kind: 'answered', outcome: 'result', mark: 'reads' });
    expect(journal.facts().map(({ type }) => type)).toEqual(['tool_call_started', 'tool_call_answered']);
  });

  it('reads the mark the server lists the tool with at the call, so one marked acts since an earlier call is refused', async () => {
    const fake = await oneCallServer();
    const access = oneCallAccess(fake.url);
    const searching = {
      reference: { server: 'graph', tool: 'search' },
      input: { query: 'acme' },
      requiredMark: 'reads',
    } as const;

    const before = await calledOnce(access, searching);
    fake.annotateTool('search', { readOnlyHint: false });
    const after = await calledOnce(access, searching);

    expect([before, after]).toMatchObject([
      { kind: 'answered', outcome: 'result' },
      { kind: 'unopened', refused: 'tool_not_read_only', mark: 'acts' },
    ]);
    expect(fake.received()).toHaveLength(1);
  });
});

describe('a call that needs its tool marked reads, to a tool marked otherwise', () => {
  it('is refused before its start is recorded or anything is sent, for a tool marked acts or carrying no mark, and lets its session go', async () => {
    const fake = await oneCallServer({ hints: { denied: { readOnlyHint: false } } });
    const access = oneCallAccess(fake.url);
    const journal = recordingCallJournal();
    const runCall = { callId, journal };

    expect([
      await calledOnce(access, { reference: { server: 'graph', tool: 'denied' }, requiredMark: 'reads' }, runCall),
      await calledOnce(access, { requiredMark: 'reads' }, runCall),
    ]).toEqual([
      {
        kind: 'unopened',
        refused: 'tool_not_read_only',
        mark: 'acts',
        detail: 'The denied tool of graph is marked acts, and the call needs one marked reads, so it was not sent',
      },
      {
        kind: 'unopened',
        refused: 'tool_not_read_only',
        mark: 'unmarked',
        detail:
          'The echo tool of graph carries no mark, which counts as acts, and the call needs one marked reads, so it was not sent',
      },
    ]);
    expect([journal.facts(), fake.received(), fake.openSessions()]).toEqual([[], [], 0]);
  });
});

describe('the wait a 429 asks for in one call', () => {
  it('is waited out within the wait its caller gives, and handed on when its caller gives none', async () => {
    const fake = await oneCallServer();
    const access = oneCallAccess(fake.url);
    const waiting = { ...echoCall, longestRetryWaitMs: 10_000 };

    fake.answerNextOf('tools/call', 429, 1, { 'retry-after': '1' });
    const waited = await calledOnce(access, waiting);
    fake.answerNextOf('tools/call', 429, 1, { 'retry-after': '1' });
    const handedOn = await calledOnce(access);

    expect([waited, handedOn]).toMatchObject([
      { outcome: 'result' },
      { outcome: 'server_failure', detail: 'The tool server answered HTTP 429', retryAfterMs: 1000 },
    ]);
  });
});
