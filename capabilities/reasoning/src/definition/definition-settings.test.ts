import { describe, expect, it } from 'vitest';

import { documentOf, issuesIn, parsed } from '../testing/definition-documents.ts';

describe('the model of a definition', () => {
  it('is written provider/model', () => {
    expect(parsed(documentOf('model: bedrock/arn:aws:bedrock:eu-central-1:1:inference-profile/x')).model).toBe(
      'bedrock/arn:aws:bedrock:eu-central-1:1:inference-profile/x',
    );
    expect(issuesIn(documentOf('model: gpt-5'))).toEqual([
      'Line 2, /model: Expected provider/model, for example anthropic/claude-sonnet-4-5',
    ]);
    expect(issuesIn(documentOf('model: openai/'))).toHaveLength(1);
  });
});

describe('the settings of a definition', () => {
  it('default to 1024 output tokens', () => {
    expect(parsed(documentOf('model: openai/gpt-5\nconfig: {temperature: 0}')).settings).toEqual({
      max_output_tokens: 1024,
      temperature: 0,
    });
  });

  it('take at most 64000 output tokens, as a whole number of 1 or more', () => {
    expect(parsed(documentOf('model: openai/gpt-5\nconfig: {max_output_tokens: 64000}')).settings).toEqual({
      max_output_tokens: 64_000,
    });
    expect(issuesIn(documentOf('model: openai/gpt-5\nconfig:\n  max_output_tokens: 64001'))).toEqual([
      'Line 4, /config/max_output_tokens: Expected at most 64000',
    ]);
    expect(issuesIn(documentOf('model: openai/gpt-5\nconfig:\n  max_output_tokens: 0.5'))).toEqual([
      'Line 4, /config/max_output_tokens: Expected an integer of 1 or more',
    ]);
  });

  it('take a seed that is a whole number of 0 or more', () => {
    expect(issuesIn(documentOf('model: openai/gpt-5\nconfig:\n  seed: -1'))).toEqual([
      'Line 4, /config/seed: Expected an integer of 0 or more',
    ]);
  });
});

const everyOffered = [
  'provider_options:',
  '  anthropic: {thinking: {type: enabled, budgetTokens: 2048}}',
  '  openai: {textVerbosity: low, reasoningMode: pro, logitBias: {"50256": -100}}',
  '  azure: {textVerbosity: high}',
  '  google: {thinkingConfig: {thinkingBudget: 0}, safetySettings: [{category: HARM_CATEGORY_HATE_SPEECH, threshold: OFF}]}',
  '  vertex: {threshold: BLOCK_ONLY_HIGH}',
  '  googleVertex: {thinkingConfig: {thinkingLevel: low}, thinking: {type: adaptive, display: omitted}}',
  '  amazonBedrock: {reasoningConfig: {type: enabled, budgetTokens: 1024}}',
  '  bedrock: {reasoningConfig: {type: adaptive, display: summarized}}',
  '  internal: {user: tenant-7}',
].join('\n');

const withheldOptions = [
  'provider_options:',
  '  anthropic:',
  '    thinking: {type: adaptive, blockBinding: {prefixMismatchBehavior: error}}',
  '    metadata: {userId: tenant-7}',
  '    anthropicBeta: [interleaved-thinking-2025-05-14]',
  '    mcpServers: [{type: url, name: crm, url: "https://crm.example/mcp"}]',
  '  openai: {store: true, temperature: 0}',
  '  bedrock: {thinking: {type: enabled}, inferenceConfig: {maxTokens: 200000}}',
  '  google: {labels: {team: sales}}',
  '  Not_A_Gateway: {user: tenant-7}',
].join('\n');

const namespaces =
  'provider_options takes anthropic, openai, azure, google, vertex, googleVertex, amazonBedrock, bedrock, or the name of a gateway';

describe('the provider options of a definition', () => {
  it('take the options that only shape how the model reasons or writes its answer, and a gateway name', () => {
    const options = parsed(documentOf(`model: anthropic/claude-sonnet-4-5\n${everyOffered}`)).provider_options;

    expect(Object.keys({ ...options })).toEqual([
      'anthropic',
      'openai',
      'azure',
      'google',
      'vertex',
      'googleVertex',
      'amazonBedrock',
      'bedrock',
      'internal',
    ]);
  });

  it('refuse every other option, naming it and saying it is not offered', () => {
    expect(issuesIn(documentOf(`model: anthropic/claude-sonnet-4-5\n${withheldOptions}`))).toEqual([
      'Line 5, /provider_options/anthropic/thinking/blockBinding: thinking.blockBinding is not offered: thinking takes type, budgetTokens, display',
      'Line 6, /provider_options/anthropic/metadata: metadata is not offered: it attributes the request on the operator account',
      'Line 7, /provider_options/anthropic/anthropicBeta: anthropicBeta is not offered: it sets request headers or betas',
      'Line 8, /provider_options/anthropic/mcpServers: mcpServers is not offered: it brings in tools or servers',
      'Line 9, /provider_options/openai/store: store is not offered: it stores or reuses state on the operator account',
      'Line 9, /provider_options/openai/temperature: temperature is not offered: openai offers textVerbosity, reasoningMode, logitBias',
      'Line 10, /provider_options/bedrock/thinking: thinking is not offered: it adds raw fields to the request',
      'Line 10, /provider_options/bedrock/inferenceConfig: inferenceConfig is not offered: bedrock offers reasoningConfig',
      'Line 11, /provider_options/google/labels: labels is not offered: it attributes the request on the operator account',
      `Line 12, /provider_options/Not_A_Gateway: Not_A_Gateway is not a provider namespace: ${namespaces}`,
    ]);
  });
});

describe('how a run of a definition ends at a limit', () => {
  it('is error unless the function says continue', () => {
    expect(parsed(documentOf('model: openai/gpt-5\ntools: [graph/search]')).exit_behavior).toBe('error');
    expect(
      parsed(documentOf('model: openai/gpt-5\ntools: [graph/search]\nexit_behavior: continue')).exit_behavior,
    ).toBe('continue');
    expect(issuesIn(documentOf('model: openai/gpt-5\ntools: [graph/search]\nexit_behavior: end'))).toEqual([
      'Line 4, /exit_behavior: Expected "error" | "continue"',
    ]);
  });

  it('is refused on a function that names no tools, which reaches no limit it sets', () => {
    const refused =
      'exit_behavior sets how a run ends at its limit of tool calls or of input tokens across its steps, which only a function that names tools has; leave it out';

    expect(issuesIn(documentOf('model: openai/gpt-5\nexit_behavior: error'))).toEqual([
      `Line 3, /exit_behavior: ${refused}`,
    ]);
    expect(issuesIn(documentOf('model: openai/gpt-5\ntools: []\nexit_behavior: continue'))).toEqual([
      `Line 4, /exit_behavior: ${refused}`,
    ]);
    expect(
      issuesIn(documentOf('model: openai/gpt-5\ntools: [graph]\nexit_behavior: continue')).map((issue) =>
        issue.slice(0, issue.indexOf(':')),
      ),
    ).toEqual(['Line 3, /tools/0']);
    expect(parsed(documentOf('model: openai/gpt-5')).exit_behavior).toBe('error');
  });
});

const withTools = (line: string) => documentOf(`model: openai/gpt-5\ntools: [graph/search]\n${line}`);

describe('the count of tool calls a definition sets', () => {
  it('takes a whole number from 1 to 1000, and is left out unless the function sets one', () => {
    expect([
      parsed(withTools('max_tool_calls: 1')).max_tool_calls,
      parsed(withTools('max_tool_calls: 1000')).max_tool_calls,
      'max_tool_calls' in parsed(withTools('exit_behavior: error')),
    ]).toEqual([1, 1000, false]);
  });

  it('refuses 0, a number past 1000 and one that is not whole, saying what to write instead', () => {
    expect([
      ...issuesIn(withTools('max_tool_calls: 0')),
      ...issuesIn(withTools('max_tool_calls: 1001')),
      ...issuesIn(withTools('max_tool_calls: 2.5')),
      ...issuesIn(withTools('max_tool_calls: -3')),
      ...issuesIn(withTools('max_tool_calls: sixty')),
    ]).toEqual([
      'Line 4, /max_tool_calls: Expected a whole number from 1 to 1000. To let the function call no tools, leave out tools',
      'Line 4, /max_tool_calls: Expected at most 1000. Left out, a run counts only its calls of tools not marked reads, to 25, and its time and its input tokens bound the rest',
      'Line 4, /max_tool_calls: Expected a whole number from 1 to 1000',
      'Line 4, /max_tool_calls: Expected a whole number from 1 to 1000',
      'Line 4, /max_tool_calls: Expected number',
    ]);
  });

  it('is refused on a function that names no tools, which makes no tool call to count', () => {
    expect(issuesIn(documentOf('model: openai/gpt-5\nmax_tool_calls: 60'))).toEqual([
      'Line 3, /max_tool_calls: max_tool_calls sets how many tool calls a run may make, which only a function that names tools makes; leave it out',
    ]);
  });
});

describe('the input tokens a definition lets a run read', () => {
  it('take a whole number from 10000 to 9999999, with tools or without, and are left out unless the function sets them', () => {
    expect([
      parsed(withTools('max_input_tokens: 10000')).max_input_tokens,
      parsed(withTools('max_input_tokens: 9999999')).max_input_tokens,
      parsed(documentOf('model: openai/gpt-5\nmax_input_tokens: 3000000')).max_input_tokens,
      'max_input_tokens' in parsed(withTools('exit_behavior: error')),
    ]).toEqual([10_000, 9_999_999, 3_000_000, false]);
  });

  it('refuse a number below 10000, past 9999999, one that is not whole, and anything but a number', () => {
    expect([
      ...issuesIn(withTools('max_input_tokens: 9999')),
      ...issuesIn(withTools('max_input_tokens: 10000000')),
      ...issuesIn(withTools('max_input_tokens: 500000.5')),
      ...issuesIn(withTools('max_input_tokens: 0')),
      ...issuesIn(withTools('max_input_tokens: a million')),
    ]).toEqual([
      'Line 4, /max_input_tokens: Expected a whole number from 10000 to 9999999',
      'Line 4, /max_input_tokens: Expected a whole number from 10000 to 9999999',
      'Line 4, /max_input_tokens: Expected a whole number from 10000 to 9999999',
      'Line 4, /max_input_tokens: Expected a whole number from 10000 to 9999999',
      'Line 4, /max_input_tokens: Expected number',
    ]);
  });
});
