import { memoryRecordedContent } from '@on.auto/operations/testing';
import { makeReasoningFunctionAdapter } from '@on.auto/reasoning';
import { scriptedLanguageModel } from '@on.auto/reasoning/testing';
import { noToolServers } from '@on.auto/tool-servers/testing';
import { describe, expect, it } from 'vitest';

import { longestCallOf } from './workflows.ts';

describe('the longest a nested run of a workflow may run', () => {
  it('is as long as its capability states, 1660 s for reasoning, and a minute more', () => {
    const reasoning = makeReasoningFunctionAdapter({
      languageModel: scriptedLanguageModel().languageModel,
      offered: { providers: [], aliases: [] },
      tools: noToolServers,
      content: memoryRecordedContent(),
    });

    expect(longestCallOf([reasoning])).toBe(1_720_000);
  });

  it('is the longest any capability states, and a minute more', () => {
    expect(longestCallOf([{ longestAnyRunMs: 5000 }, { longestAnyRunMs: 90_000 }])).toBe(150_000);
  });
});
