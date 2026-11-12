import { presentationOf, type RecordedEvent } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { makeDefinitionPresenters } from '../index.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { testRunId } from '../testing/run-facts.ts';

const { present } = presentationOf(makeDefinitionPresenters([echo]));

const fileOfRows = { uri: 'file:///rows.json', mimeType: 'application/json', text: '{"rows":[]}' };

const kept: Readonly<Record<string, string>> = {
  ['c'.repeat(64)]: JSON.stringify({
    content: [
      { type: 'text', text: 'Read rows.json.' },
      { type: 'resource', resource: fileOfRows },
    ],
  }),
};

const answered = {
  number: 3,
  is_error: false,
  result_bytes: 112,
  result_sha256: 'c'.repeat(64),
  shown_format: 2,
  duration_ms: 120,
  jsonrpc_id: 7,
};

const recorded: RecordedEvent = {
  id: '0b1c2d3e-4f50-5a6b-8c7d-8e9fa0b1c2d4',
  cursor: 'WyJicmFpbi9hY21lL2FscGhhLyIsIjIiXQ',
  causationId: '1c2d3e4f-5a6b-5c7d-8e9f-a0b1c2d3e4f5',
  correlationId: testRunId,
  stream: `runs/${testRunId}`,
  version: 4,
  globalPosition: 12,
  type: 'tool_call_answered',
  data: answered,
  context: {
    runId: testRunId,
    by: 'acme-admin',
    at: '2026-10-01T09:00:01.000Z',
    definitionType: 'echo',
    definitionName: 'greet',
    definitionVersion: 2,
  },
  recordedAt: '2026-10-01T09:00:02.000Z',
};

describe('the presenter of the end of a tool call whose answer carried a file', () => {
  it('presents the answer a reader reads of it, the text of the file after the line before it, and the format its call names', () => {
    const shown = present(recorded, {
      streamPrefix: 'playbook/acme/alpha/',
      content: (sha256) => kept[sha256],
      view: 'page',
    }).at(0);

    expect(shown).toMatchObject({
      summary: 'Tool call 3 answered.',
      data: { ...answered, answer: 'Read rows.json.\n{"rows":[]}' },
    });
  });
});
