import { openaiLanguageModelChatOptions } from '@ai-sdk/openai/internal';
import { describe, expect, it } from 'vitest';

import { decidedOptions, offeredOptions, optionCheckFor, providerNamespaces } from './offered-provider-options.ts';

const offered: Readonly<Record<string, readonly string[]>> = {
  anthropic: ['thinking'],
  openai: ['textVerbosity', 'reasoningMode', 'logitBias'],
  azure: ['textVerbosity', 'reasoningMode', 'logitBias'],
  google: ['thinkingConfig', 'safetySettings', 'threshold'],
  vertex: ['thinkingConfig', 'safetySettings', 'threshold'],
  googleVertex: ['thinkingConfig', 'safetySettings', 'threshold', 'thinking'],
  amazonBedrock: ['reasoningConfig'],
  bedrock: ['reasoningConfig'],
};

const reasons = [
  'it attributes the request on the operator account',
  'it stores or reuses state on the operator account',
  'it chooses routing, fallbacks or capacity',
  'it sets request headers or betas',
  'it brings in tools or servers',
  'it adds raw fields to the request',
  'the front matter sets it',
  'the runtime manages conversation state',
  'it asks for output the runtime does not read',
  'it changes how the runtime sends the request',
];

function verdictsOf(namespace: string, option: string): readonly string[] {
  const check = optionCheckFor(namespace);
  return check === undefined ? ['no check'] : check(option, true).map(({ detail }) => detail);
}

describe('the provider options a reasoning function may set', () => {
  it('are kept for the namespaces of the built-in providers', () => {
    expect(providerNamespaces).toEqual(Object.keys(offered));
    expect(optionCheckFor('mistral')).toBeUndefined();
    expect(decidedOptions('mistral')).toEqual([]);
    expect(offeredOptions('mistral')).toEqual([]);
  });

  it.each(Object.entries(offered))('are only those that shape the answer, for %s', (namespace, options) => {
    const decided = decidedOptions(namespace);
    const accepted = decided.filter((option) => verdictsOf(namespace, option).length === 0);
    const refused = decided.filter((option) => !accepted.includes(option));

    expect(accepted).toEqual(options);
    expect(offeredOptions(namespace)).toEqual(options);
    for (const option of refused) {
      expect(reasons.map((reason) => `${option} is not offered: ${reason}`)).toContain(
        verdictsOf(namespace, option).join(),
      );
    }
  });

  it('decide every option of the OpenAI chat schema the SDK exports, so an upgrade that adds one fails', async () => {
    const schema = await openaiLanguageModelChatOptions().jsonSchema;
    const options = Object.keys({ ...schema.properties });

    expect(options.length).toBeGreaterThan(10);
    expect(options.filter((option) => !decidedOptions('openai').includes(option))).toEqual([]);
  });
});

describe('a provider option that is not offered', () => {
  it('is refused when no provider of the namespace reads it, saying what the namespace offers', () => {
    expect(verdictsOf('openai', 'temperature')).toEqual([
      'temperature is not offered: openai offers textVerbosity, reasoningMode, logitBias',
    ]);
  });

  it('is refused under an offered option when it is not pure shaping', () => {
    const check = optionCheckFor('anthropic');

    expect(check?.('thinking', { type: 'adaptive', display: 'summarized', blockBinding: {} })).toEqual([
      {
        path: ['thinking', 'blockBinding'],
        detail: 'thinking.blockBinding is not offered: thinking takes type, budgetTokens, display',
      },
    ]);
    expect(check?.('thinking', 'adaptive')).toEqual([]);
  });

  it('is refused on Bedrock when Bedrock would send it as it is, though Anthropic models read it', () => {
    expect(verdictsOf('bedrock', 'thinking')).toEqual(['thinking is not offered: it adds raw fields to the request']);
  });
});
