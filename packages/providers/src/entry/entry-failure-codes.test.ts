import { describe, expect, it } from 'vitest';

import { problemsOf } from '../testing/entry-problems.ts';
import { ledgers, tracker } from '../testing/fixture-providers.ts';

const failureCodes = { succeeded: '/ok', code: '/error', key_refused: ['revoked'] };

describe('the failure codes of an entry', () => {
  it('are taken for an HTTP API, with their pointers into the answer and each code once, and for no MCP server', () => {
    expect(problemsOf({ ...ledgers, failure_codes: failureCodes })).toEqual([]);
    expect(
      problemsOf({ ...ledgers, failure_codes: { ...failureCodes, succeeded: 'ok', rate_limited: ['revoked'] } }),
    ).toEqual([
      ['/failure_codes/succeeded', 'Expected a JSON pointer into the answer, such as /ok'],
      ['/failure_codes/rate_limited/0', 'revoked is named twice, and a code means one failure'],
    ]);
    expect(problemsOf({ ...tracker, failure_codes: failureCodes })).toEqual([
      ['/failure_codes', 'Expected no failure_codes: an mcp provider takes url'],
    ]);
  });
});
