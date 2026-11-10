import type { RunEnding } from '@on.auto/definitions';
import { describe, expect, it } from 'vitest';

import { resultOfEnding } from './recorded-waiting.ts';

const onTheRun = {
  at: '2026-10-01T09:00:00.000Z',
  by: 'acme-admin',
  runId: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  definitionType: 'computation',
  definitionName: 'score',
  definitionVersion: 1,
};

describe('the result a test hands a parent for its child’s ending', () => {
  it('is the output of a success that holds it, and a failure for one whose output is kept outside it', () => {
    const inline: RunEnding = { type: 'run_succeeded', data: { output: 'done', record: {} }, context: onTheRun };
    const kept: RunEnding = {
      type: 'run_succeeded',
      data: { output_sha256: 'c'.repeat(64), output_bytes: 4096, record: {} },
      context: onTheRun,
    };

    expect([resultOfEnding(inline), resultOfEnding(kept)]).toEqual([
      { status: 'succeeded', output: 'done' },
      { status: 'failed', detail: 'The run succeeded with an output kept outside it' },
    ]);
  });
});
