import type { RecordedCall } from '@on.auto/definitions';
import { textToKeep } from '@on.auto/operations';
import { memoryRecordedContent } from '@on.auto/operations/testing';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { toolCallsResult } from '../testing/model-results.ts';
import { reasoningOf } from '../testing/reasoning-runs.ts';
import {
  aGraph,
  attemptOf,
  graphAccessTo,
  recordedBy,
  stopping,
  withGraphTools,
  withoutTools,
} from '../testing/resumed-attempts.ts';
import { answers } from '../testing/scripted-language-model.ts';

function sentAs(calls: readonly RecordedCall[], sha256: string): readonly RecordedCall[] {
  return calls.map((call) =>
    call.type === 'model_call_started' ? { ...call, data: { ...call.data, messages_sha256: sha256 } } : call,
  );
}

describe('a run that goes on from facts whose content it cannot read', () => {
  it('is unavailable because the server restarted and there is no content to go on from, its open call ended', async () => {
    const { calls } = await recordedBy(withoutTools, {}, stopping);
    const again = reasoningOf({ attempt: attemptOf(calls), content: memoryRecordedContent() });

    expect(await again.running(withoutTools)).toEqual(
      Exit.fail(
        expect.objectContaining({
          _tag: 'unavailable',
          because: 'restarted_without_content',
          detail:
            'The server restarted before the run finished, and the playbook keeps no content of its calls to go on from',
        }),
      ),
    );
    expect(again.requests()).toEqual([]);
    expect(again.journal.recorded()).toMatchObject([
      { type: 'model_call_failed', number: 1, data: { because: 'interrupted' } },
    ]);
  });

  it('is unfinished for a run whose servers keep no content, once it called a tool, every open call ended', async () => {
    const tools = graphAccessTo((await aGraph()).url, { record_content: false });
    const asking = answers(toolCallsResult([['graph__search', { query: 'acme' }]]));
    const { calls } = await recordedBy(withGraphTools, { tools }, asking, stopping);
    const again = reasoningOf({ tools, attempt: attemptOf(calls.slice(0, -2)) });

    expect(await again.running(withGraphTools)).toEqual(
      Exit.fail(
        expect.objectContaining({
          _tag: 'unavailable',
          kind: 'tools_unfinished',
          because: 'restarted_without_content',
        }),
      ),
    );
    expect(again.journal.recorded()).toMatchObject([
      { type: 'tool_call_failed', number: 1, data: { because: 'interrupted' } },
    ]);
  });
});

describe('a run that goes on from content it kept that it cannot use', () => {
  it('is unfinished when what it kept after its prompt is gone, every open call ended', async () => {
    const tools = graphAccessTo((await aGraph()).url);
    const asking = answers(toolCallsResult([['graph__search', { query: 'acme' }]]));
    const { calls } = await recordedBy(withGraphTools, { tools }, asking, stopping);
    const onlyThePrompt = memoryRecordedContent();
    const prompt = textToKeep(JSON.stringify({ kind: 'prompt', message: 'Summarize acme.' }), 'application/json');
    await Effect.runPromise(onlyThePrompt.put({ org: 'acme', playbook: 'alpha' }, prompt));
    const again = reasoningOf({ tools, attempt: attemptOf(calls), content: onlyThePrompt });

    expect(await again.running(withGraphTools)).toEqual(
      Exit.fail(expect.objectContaining({ kind: 'tools_unfinished', because: 'restarted_without_content' })),
    );
    expect(again.journal.recorded()).toMatchObject([
      { type: 'model_call_failed', number: 2, data: { because: 'interrupted' } },
    ]);
  });

  it('is unavailable as well when the content its first model call kept is not a prompt', async () => {
    const content = memoryRecordedContent();
    const results = textToKeep(JSON.stringify({ kind: 'results', messages: [] }), 'application/json');
    const { sha256 } = await Effect.runPromise(content.put({ org: 'acme', playbook: 'alpha' }, results));
    const { calls } = await recordedBy(withoutTools, {}, stopping);

    expect(await reasoningOf({ attempt: attemptOf(sentAs(calls, sha256)), content }).running(withoutTools)).toEqual(
      Exit.fail(expect.objectContaining({ because: 'restarted_without_content' })),
    );
  });
});
