import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { recordedInputLogs, recordInputLog } from './input-log-corpus.ts';

const log = {
  name: 'example',
  inputs: [
    {
      kind: 'cancel_requested',
      runId: '0199a3c4-7d2e-7c1a-9b3f-000000000300',
      at: 1,
      cancel: { by: 'tester', kind: 'requested', reason: 'The test cancelled the run' },
    },
  ],
  events: [],
} as const;

describe('a corpus of input logs', () => {
  it('records a log only when RECORD_INPUT_LOGS is 1, and reads back what it recorded', () => {
    const corpus = `${mkdtempSync(join(tmpdir(), 'input-logs-'))}/`;
    recordInputLog(log, {}, corpus);
    const before = recordedInputLogs(corpus);
    recordInputLog(log, { RECORD_INPUT_LOGS: '1' }, corpus);
    const after = recordedInputLogs(corpus);
    rmSync(corpus, { recursive: true });

    expect(before).toEqual([]);
    expect(after).toEqual([log]);
  });
});
