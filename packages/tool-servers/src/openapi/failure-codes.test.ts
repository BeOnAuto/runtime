import { describe, expect, it } from 'vitest';

import { failureOf } from '../clients/server-failures.ts';
import { failedAnswerOf, failureCodeIssuesOf, failureCodesOf, type FailureCodes } from './failure-codes.ts';

const slackLike: FailureCodes = {
  succeeded: '/ok',
  code: '/error',
  key_refused: ['invalid_auth', 'token_revoked'],
  scope_lacking: ['missing_scope'],
  rate_limited: ['ratelimited'],
};

function failingOf(answer: unknown, codes: FailureCodes = slackLike): unknown {
  const failed = failedAnswerOf(codes, answer);
  return failed?.error === undefined ? failed : failureOf(failed.error);
}

describe('the failure codes an entry declares', () => {
  it('are taken with their two pointers into the answer and each code named once, or not given at all', () => {
    expect([failureCodeIssuesOf(slackLike), failureCodeIssuesOf()]).toEqual([[], []]);
    expect(failureCodeIssuesOf({ succeeded: '/result/~1ok~0', code: '/errors/0/code' })).toEqual([]);
    expect([failureCodesOf(slackLike), failureCodesOf()]).toEqual([{ failure_codes: slackLike }, {}]);
  });

  it('are refused where a pointer is none, where a list names no code, and where a code is named twice', () => {
    expect(
      failureCodeIssuesOf({
        succeeded: 'ok',
        code: '/error~2',
        key_refused: ['invalid_auth', 'invalid_auth'],
        scope_lacking: [],
        rate_limited: ['invalid_auth'],
      }),
    ).toEqual([
      { path: ['succeeded'], detail: 'Expected a JSON pointer into the answer, such as /ok' },
      { path: ['code'], detail: 'Expected a JSON pointer into the answer, such as /error' },
      { path: ['scope_lacking'], detail: 'Expected at least one code; leave scope_lacking out where no code means it' },
      { path: ['key_refused', 1], detail: 'invalid_auth is named twice, and a code means one failure' },
      { path: ['rate_limited', 0], detail: 'invalid_auth is named twice, and a code means one failure' },
    ]);
  });
});

describe('an answer read by the failure codes of its entry', () => {
  it('is no failure where it does not say it failed, as where the boolean is true, missing or no boolean', () => {
    expect([
      failedAnswerOf(slackLike, { ok: true, warning: 'superfluous_charset' }),
      failedAnswerOf(slackLike, { messages: [] }),
      failedAnswerOf(slackLike, { ok: 'false', error: 'invalid_auth' }),
      failedAnswerOf(slackLike, ['ok']),
      failedAnswerOf(slackLike, null),
    ]).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it('is the failure its code means, in words that name the code', () => {
    expect([
      failingOf({ ok: false, error: 'token_revoked' }),
      failingOf({ ok: false, error: 'missing_scope', needed: 'reactions:read' }),
      failingOf({ ok: false, error: 'ratelimited' }),
    ]).toEqual([
      { kind: 'key_refused', message: 'The tool server answered token_revoked' },
      {
        kind: 'scope_lacking',
        message:
          'The tool server answered missing_scope: the credential lacks a scope this request needs; a credential granted that scope would allow it',
      },
      { kind: 'rate_limited', message: 'The tool server answered ratelimited' },
    ]);
  });

  it('is a failure no code explains where its code means nothing named, or it names none', () => {
    expect([
      failedAnswerOf(slackLike, { ok: false, error: 'channel_not_found' }),
      failedAnswerOf(slackLike, { ok: false }),
      failedAnswerOf(slackLike, { ok: false, error: 7 }),
      failedAnswerOf({ succeeded: '/ok', code: '/error' }, { ok: false, error: 'invalid_auth' }),
    ]).toEqual([{ error: undefined }, { error: undefined }, { error: undefined }, { error: undefined }]);
  });

  it('follows its pointers through objects and lists, their tokens unescaped', () => {
    const nested: FailureCodes = { succeeded: '/result/a~1b', code: '/errors/0/c~0d', key_refused: ['expired'] };

    expect(failingOf({ result: { 'a/b': false }, errors: [{ 'c~d': 'expired' }] }, nested)).toEqual({
      kind: 'key_refused',
      message: 'The tool server answered expired',
    });
  });
});

describe('the pointers of failure codes into an answer', () => {
  it('follow the answer’s own properties alone, so a pointer to an inherited one reaches nothing', () => {
    const inherited: FailureCodes = { succeeded: '/ok', code: '/constructor/name', key_refused: ['Object'] };

    expect([
      failingOf({ ok: false, error: 'expired' }, inherited),
      failingOf({ ok: false, constructor: { name: 'Object' } }, inherited),
    ]).toEqual([{ error: undefined }, { kind: 'key_refused', message: 'The tool server answered Object' }]);
  });
});
