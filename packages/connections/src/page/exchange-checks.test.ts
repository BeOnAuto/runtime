import type { AssertionChecked, CalledOnce } from '@on.auto/tool-servers';
import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { listingOf } from '../testing/exchanges.ts';
import { exchangeRefusalOf, mostReachedNames, namesReachedIn, reachedOf, type ReachedAt } from './exchange-checks.ts';

const connection = { name: 'mail', provider: 'mail', status: 'pending' } as const;

const auth = { token_endpoint: 'https://sts.mail.example.com/v1/token' };

const refusals: readonly (readonly [AssertionChecked, string])[] = [
  [{ kind: 'refused', code: 'invalid_grant' }, 'invalid_input'],
  [{ kind: 'unreached', hosts: ['sts.mail.example.com'] }, 'unavailable'],
  [
    {
      kind: 'unanswered',
      call: { step: 'token', host: 'sts.mail.example.com', answer: { status: 503, retryAfterMs: null } },
    },
    'unavailable',
  ],
  [{ kind: 'conflicting', refusal: { refused: 'no_metadata' } }, 'conflict'],
];

describe('what the exchange of a token at an approval or a test answers', () => {
  it('answers no refusal where the token was had', () => {
    expect(exchangeRefusalOf(connection, auth, { kind: 'taken' })).toBeUndefined();
  });

  it.each(refusals)('answers %o as a refusal of the reason %s', (checked, reason) => {
    expect(exchangeRefusalOf(connection, auth, checked)).toMatchObject({ _tag: reason });
  });
});

const failed: CalledOnce = {
  kind: 'answered',
  outcome: 'timed_out',
  failed: { because: 'timed_out', duration_ms: 3, jsonrpc_id: 1 },
  detail: '',
  retryAfterMs: null,
  mark: 'reads',
};

const toolError: CalledOnce = {
  kind: 'answered',
  outcome: 'tool_error',
  answered: { is_error: true, result_bytes: 2, duration_ms: 3, jsonrpc_id: 1 },
  detail: '',
  retryAfterMs: null,
  mark: 'reads',
};

const unopened: CalledOnce = {
  kind: 'unopened',
  refused: 'tool_server_failed',
  because: 'unreachable',
  detail: 'down',
};

const atTheAddress = { list: '/mailboxes', name: '/address' };

const listings: readonly (readonly [string, Schema.Json, ReachedAt, readonly string[]])[] = [
  [
    'names at the pointer within each item, numbers among them',
    { mailboxes: [{ address: 'a' }, { address: 42 }] },
    atTheAddress,
    ['a', '42'],
  ],
  [
    'the items themselves, where the pointer to the name is empty',
    { resourceNames: ['customers/1', 'customers/2'] },
    { list: '/resourceNames', name: '' },
    ['customers/1', 'customers/2'],
  ],
  ['nothing where the answer leaves the list out', {}, atTheAddress, []],
  ['nothing where the list is not one', { mailboxes: 'none' }, atTheAddress, []],
  [
    'no item without a name a person can read',
    { mailboxes: [{ address: '' }, { address: 1.5 }, {}] },
    atTheAddress,
    [],
  ],
];

describe('what a check of a connection reaches', () => {
  it.each([
    ['a result', listingOf('a@acme.example.com'), false, ['a@acme.example.com']],
    ['a refusal of its credential', listingOf('a@acme.example.com'), true, []],
    ['an error of the tool', toolError, false, []],
    ['a call that failed', failed, false, undefined],
    ['a call that never opened', unopened, false, undefined],
  ] as const)('reads %s', (_named, called, toldRefused, reached) => {
    expect(reachedOf(called, toldRefused, atTheAddress, mostReachedNames)).toEqual(reached);
  });

  it.each(listings)('lists %s', (_named, structuredContent, reachedAt, names) => {
    expect(namesReachedIn({ content: [], structuredContent }, reachedAt, mostReachedNames)).toEqual(names);
  });

  it('lists at most the names it is given room for, 50 when it ships', () => {
    const answer = { content: [], structuredContent: { mailboxes: ['a', 'b', 'c'].map((address) => ({ address })) } };

    expect([namesReachedIn(answer, atTheAddress, 2), mostReachedNames]).toEqual([['a', 'b'], 50]);
  });
});
