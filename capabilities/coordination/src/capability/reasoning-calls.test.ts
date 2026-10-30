import { memoryLedger, memoryRecordedContent } from '@on.auto/operations/testing';
import { makeReasoningFunctionAdapter, readReasoningFunctionDefinition, resumesAfterMsOf } from '@on.auto/reasoning';
import { scriptedLanguageModel } from '@on.auto/reasoning/testing';
import { noToolServers } from '@on.auto/tool-servers/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { playbookOn } from '../testing/playbook.ts';
import { recordingStarts, recordingWorkflows } from '../testing/recording-starts.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-555555555554';

const reasoning = makeReasoningFunctionAdapter({
  languageModel: scriptedLanguageModel().languageModel,
  tools: noToolServers,
  content: memoryRecordedContent(),
  offered: { providers: ['anthropic'], aliases: [] },
});

function reasoningSource(maxOutputTokens: number): string {
  return `---\nmodel: anthropic/claude-sonnet-4-5\nconfig:\n  max_output_tokens: ${maxOutputTokens}\n---\nSum up {{ input.text }}`;
}

const brief = reasoningSource(1000);

const thorough = reasoningSource(64_000);

const calling = [
  "document: { dsl: '1.0.3', namespace: acme, name: calling, version: '1.0.0' }",
  'do:',
  "  - brief: { call: run_definition, with: { type: reasoning, name: brief, input: { text: 'a' } } }",
  "  - thorough: { call: run_definition, with: { type: reasoning, name: thorough, input: { text: 'b' } } }",
  '  - itself: { call: run_definition, with: { type: workflow, name: calling } }',
].join('\n');

function resumesAfterOfTheSource(source: string): number {
  return resumesAfterMsOf(Effect.runSync(readReasoningFunctionDefinition(source)), noToolServers.callMs);
}

describe('the calls of a workflow to reasoning functions', () => {
  it('each carry the interval after which its run may be resumed, resumesAfterMsOf its own definition, and a call of a workflow, whose runs do not resume, none', async () => {
    const { starts, recording } = recordingStarts();
    const playbook = playbookOn(memoryLedger(), [recordingWorkflows(recording), reasoning]);
    await playbook.call(playbook.createDefinition, { type: 'reasoning', name: 'brief', source: brief });
    await playbook.call(playbook.createDefinition, { type: 'reasoning', name: 'thorough', source: thorough });
    await playbook.call(playbook.createDefinition, { type: 'workflow', name: 'calling', source: calling });

    await playbook.call(playbook.runDefinition, { type: 'workflow', name: 'calling', run_id: runId });

    expect(starts.map(({ attributes }) => attributes['resumes_after_ms_by_task'])).toEqual([
      { '/do/0/brief': resumesAfterOfTheSource(brief), '/do/1/thorough': resumesAfterOfTheSource(thorough) },
    ]);
  });
});
