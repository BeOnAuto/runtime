import type { CalledOnce, OneCall } from '@on.auto/tool-servers';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { isRefusedForTheAccount } from '../entry/conversation-parts.ts';
import { typingShownBy, typingShownThrough } from './typing-calls.ts';

const typing = {
  tool: 'set_status',
  with: { channel: '{{ sent.conversation }}', thread: '{{ reply.to }}', to: '{{ to }}', status: 'is working' },
};

const codes = {
  succeeded: '/ok',
  code: '/error',
  key_refused: ['invalid_auth', 'token_revoked'],
  scope_lacking: ['missing_scope'],
  rate_limited: ['ratelimited'],
} as const;

function answered(outcome: 'result' | 'tool_error', detail = ''): CalledOnce {
  const answering = { kind: 'answered', mark: 'acts', detail, retryAfterMs: null } as const;
  const fact = { is_error: outcome === 'tool_error', result_bytes: 2, duration_ms: 1, jsonrpc_id: 1 };
  return outcome === 'result'
    ? { ...answering, outcome, answer: { content: [] }, answered: fact }
    : { ...answering, outcome, answered: fact };
}

function failedAs(because?: 'key_refused' | 'scope_lacking' | 'rate_limited' | 'unreachable'): CalledOnce {
  const failed = { because: 'server_failure', duration_ms: 1, jsonrpc_id: 1 } as const;
  const said = {
    kind: 'answered',
    mark: 'acts',
    detail: '',
    retryAfterMs: null,
    outcome: 'server_failure',
    failed,
  } as const;
  return because === undefined ? said : { ...said, because };
}

const notOpened: CalledOnce = { kind: 'unopened', refused: 'tool_server_failed', because: 'unreachable', detail: '' };

const listing = { ...typing, refused: ['feature_disabled', 'invalid_auth', 'token_revoked', 'missing_scope'] };

describe('an answer of the tool that shows the sign', () => {
  it.each([
    [
      'an error whose code at the pointer is listed',
      answered('tool_error', '{"ok":false,"error":"feature_disabled"}'),
      true,
    ],
    ['an error whose code is not listed', answered('tool_error', '{"ok":false,"error":"channel_not_found"}'), false],
    ['an error that names no code at the pointer', answered('tool_error', '{"ok":false}'), false],
    ['an error that is no JSON', answered('tool_error', 'The server is busy'), false],
    ['a refused key, every code of which is listed', failedAs('key_refused'), true],
    ['a lacking scope, every code of which is listed', failedAs('scope_lacking'), true],
    ['a limited rate, none of whose codes is listed', failedAs('rate_limited'), false],
    ['a failure no code names', failedAs('unreachable'), false],
    ['a failure that says no reason', failedAs(), false],
    ['a call never opened', notOpened, false],
    ['a result', answered('result'), false],
  ])('means the service shows no sign in the account where it is %s', (_, called, refused) => {
    expect(isRefusedForTheAccount(called, listing, codes)).toBe(refused);
  });

  it('never means so where the entry lists no codes, or says not where a failed answer names its code', () => {
    const listed = answered('tool_error', '{"ok":false,"error":"feature_disabled"}');

    expect([isRefusedForTheAccount(listed, typing, codes), isRefusedForTheAccount(listed, listing)]).toEqual([
      false,
      false,
    ]);
  });
});

interface Showing {
  readonly answer: CalledOnce;
  readonly mostBytes?: number;
}

function shownWith({ answer, mostBytes = 1_048_576 }: Showing) {
  const calls: OneCall[] = [];
  const through = {
    callOnce: (call: OneCall) =>
      Effect.sync(() => {
        calls.push(call);
        return answer;
      }),
    mostRequestBytesTo: () => mostBytes,
  };
  const repliedIn = {
    to: '#sales',
    sent: { conversation: 'C0123', id: '1699.1' },
    reply: { id: '1699.2', to: '1699.1' },
  };
  const asked = { org: 'acme', playbook: 'alpha', connection: 'chat', typing: listing, failureCodes: codes, repliedIn };
  return Effect.runPromise(Effect.map(typingShownThrough(through, asked), (shown) => ({ shown, calls })));
}

describe('the sign shown through a connection', () => {
  it('is asked of the tool of the part through the connection, its arguments rendered for the reply, nothing of it recorded', async () => {
    const { shown, calls } = await shownWith({ answer: answered('result') });

    expect(shown).toBe('shown');
    expect(calls).toEqual([
      {
        org: 'acme',
        playbook: 'alpha',
        reference: { server: 'chat', tool: 'set_status' },
        input: { channel: 'C0123', thread: '1699.1', to: '#sales', status: 'is working' },
        meta: {},
        recordContent: false,
      },
    ]);
  });

  it.each([
    ['refused where the service shows no sign in the account', { answer: failedAs('scope_lacking') }, 'refused', 1],
    ['failed where the call fails otherwise', { answer: notOpened }, 'failed', 1],
    [
      'failed, and not asked, where its arguments render more than the connection takes',
      { answer: answered('result'), mostBytes: 8 },
      'failed',
      0,
    ],
  ] as const)('is %s', async (_, showing, shown, asked) => {
    const { shown: answeredAs, calls } = await shownWith(showing);

    expect([answeredAs, calls.length]).toEqual([shown, asked]);
  });

  it('is failed where the caller reaches no connection', async () => {
    const repliedIn = {
      to: '#sales',
      sent: { conversation: 'C0123', id: '1699.1' },
      reply: { id: '1699.2', to: '1699.1' },
    };
    const called: string[] = [];
    const reachingNone = (tool: string) => Effect.sync(() => void called.push(tool));

    const shown = await Effect.runPromise(
      typingShownBy(reachingNone, 1_048_576, { typing: listing, failureCodes: codes, repliedIn }),
    );

    expect([shown, called]).toEqual(['failed', ['set_status']]);
  });
});
