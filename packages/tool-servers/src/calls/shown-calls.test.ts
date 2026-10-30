import type { KeptContent } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { callFieldsShown, keptAnswerOf, keptArgumentsOf } from './shown-calls.ts';

const kept: Readonly<Record<string, string>> = {
  sent: '{"query":"acme"}',
  structured: '{"content":[],"structuredContent":{"rows":2}}',
  empty: '{"content":[]}',
  broken: '{"content":',
};

const content: KeptContent = (sha256) => kept[sha256];

describe('the content a fact of a call kept, as a reader sees it', () => {
  it('is the arguments as the object they were sent as', () => {
    expect(keptArgumentsOf({ arguments_sha256: 'sent' }, content)).toEqual({
      arguments: { query: 'acme' },
    });
  });

  it('is the answer as the server gave it, with the document a reader of the answer reads', () => {
    expect(keptAnswerOf({ result_sha256: 'structured' }, content)).toEqual({
      result: { content: [], structuredContent: { rows: 2 } },
      answer: { rows: 2 },
    });
    expect(keptAnswerOf({ result_sha256: 'empty' }, content)).toEqual({
      result: { content: [] },
    });
  });

  it('is nothing where the fact names no digest, as one whose content was not kept, or the kept text cannot be read', () => {
    expect([
      keptArgumentsOf({}, content),
      keptArgumentsOf({ arguments_sha256: 'broken' }, content),
      keptAnswerOf({}, content),
      keptAnswerOf({ result_sha256: 'missing' }, content),
      keptAnswerOf({ result_sha256: 'broken' }, content),
    ]).toEqual([{}, {}, {}, {}, {}]);
  });
});

describe('the fields of a call, as a reader sees them', () => {
  it('cut the texts a server or a caller gave at their bounds, and keep every other field as it is', () => {
    expect(
      callFieldsShown({
        call_id: 'c'.repeat(300),
        server: 's'.repeat(300),
        tool: 't'.repeat(300),
        arguments_sha256: 'a'.repeat(300),
        jsonrpc_id: 'r'.repeat(300),
        server_request_id: 'q'.repeat(300),
        detail: 'd'.repeat(2000),
        duration_ms: 4,
        is_error: false,
        since: null,
      }),
    ).toEqual({
      call_id: 'c'.repeat(256),
      server: 's'.repeat(256),
      tool: 't'.repeat(256),
      arguments_sha256: 'a'.repeat(128),
      jsonrpc_id: 'r'.repeat(128),
      server_request_id: 'q'.repeat(256),
      detail: 'd'.repeat(1024),
      duration_ms: 4,
      is_error: false,
      since: null,
    });
  });
});
