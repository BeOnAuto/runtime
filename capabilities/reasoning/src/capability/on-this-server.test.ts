import { describe, expect, it } from 'vitest';

import { onThisServer } from './on-this-server.ts';

const onlyItsOperators = 'a run reads at most 2,000,000 input tokens, which max_input_tokens may only lower';

describe('the sentence the reasoning-function guide ends with on a server', () => {
  it('names the providers a reasoning function names its model through, and says it may name tools', () => {
    expect(
      onThisServer({
        offered: { providers: ['anthropic', 'gateway'], aliases: [] },
        toolsConfigured: true,
      }),
    ).toBe(
      `On this server, a reasoning function names its model through anthropic and gateway, written anthropic/<model id> or gateway/<model id>; it may name the tools of the tool servers that search finds; ${onlyItsOperators}.`,
    );
  });

  it('names the models its operator named, with the references a wildcard among them accepts', () => {
    expect(
      onThisServer({
        offered: { providers: ['gateway'], aliases: ['house/fast', 'anthropic/*'] },
        toolsConfigured: false,
      }),
    ).toBe(
      `On this server, a reasoning function names its model through gateway, written gateway/<model id>, or one of the models its operator named: house/fast, anthropic/*, where a name that ends in * stands for any model id, so anthropic/<model id> runs; no tool server is configured, so it may name no tools; ${onlyItsOperators}.`,
    );
  });

  it('names only the models its operator named where no provider may be named directly', () => {
    expect(onThisServer({ offered: { providers: [], aliases: ['house/fast'] }, toolsConfigured: false })).toBe(
      `On this server, a reasoning function names one of the models its operator named: house/fast; no tool server is configured, so it may name no tools; ${onlyItsOperators}.`,
    );
  });

  it('says that no reasoning function can run before a model provider is configured', () => {
    expect(onThisServer({ offered: { providers: [], aliases: [] }, toolsConfigured: false })).toBe(
      `On this server, no model provider is configured yet, so a reasoning function cannot run until whoever runs the server configures one; no tool server is configured, so it may name no tools; ${onlyItsOperators}.`,
    );
  });
});

describe('the sentence while no model provider is configured', () => {
  it('says how a person adds a provider, where the server says, while there is none', () => {
    const setup = 'To add one, the person puts a key in the settings of the server.';
    const serving = (providers: readonly string[], aliases: readonly string[]) =>
      onThisServer({
        offered: { providers, aliases },
        toolsConfigured: false,
        providerSetup: setup,
      });

    expect(serving([], [])).toMatch(/may only lower\. To add one, /u);
    expect(serving(['anthropic'], [])).not.toContain(setup);
    expect(serving([], ['house/fast'])).not.toContain(setup);
  });
});

describe('the input tokens a run reads, as the sentence gives them', () => {
  it('are its operator’s number where its host gives one number for both, which a function may only lower', () => {
    expect(
      onThisServer({
        offered: { providers: ['anthropic'], aliases: [] },
        toolsConfigured: true,
        reading: { defaultInputTokens: 300_000, mostInputTokens: 300_000 },
      }),
    ).toMatch(/; a run reads at most 300,000 input tokens, which max_input_tokens may only lower\.$/u);
  });

  it('are the default and the most a function may raise them to, where its host allows more', () => {
    expect(
      onThisServer({
        offered: { providers: ['auto'], aliases: [] },
        toolsConfigured: true,
        reading: { defaultInputTokens: 500_000, mostInputTokens: 9_999_999 },
      }),
    ).toMatch(/; a run reads at most 500,000 input tokens, or its function's max_input_tokens, up to 9,999,999\.$/u);
  });
});
