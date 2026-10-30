import { describe, expect, it } from 'vitest';

import { onThisServer } from './on-this-server.ts';

describe('the sentence the reasoning-function guide ends with on a server', () => {
  it('names the providers a reasoning function names its model through, and says it may name tools', () => {
    expect(onThisServer({ providers: ['anthropic', 'gateway'], aliases: [] }, true)).toBe(
      'On this server, a reasoning function names its model through anthropic and gateway, written anthropic/<model id> or gateway/<model id>; it may name the tools of the tool servers that search finds.',
    );
  });

  it('names the models its operator named, with the references a wildcard among them accepts', () => {
    expect(onThisServer({ providers: ['gateway'], aliases: ['house/fast', 'anthropic/*'] }, false)).toBe(
      'On this server, a reasoning function names its model through gateway, written gateway/<model id>, or one of the models its operator named: house/fast, anthropic/*, where a name that ends in * stands for any model id, so anthropic/<model id> runs; no tool server is configured, so it may name no tools.',
    );
  });

  it('names only the models its operator named where no provider may be named directly', () => {
    expect(onThisServer({ providers: [], aliases: ['house/fast'] }, false)).toBe(
      'On this server, a reasoning function names one of the models its operator named: house/fast; no tool server is configured, so it may name no tools.',
    );
  });

  it('says that no reasoning function can run before a model provider is configured', () => {
    expect(onThisServer({ providers: [], aliases: [] }, false)).toBe(
      'On this server, no model provider is configured yet, so a reasoning function cannot run until whoever runs the server configures one; no tool server is configured, so it may name no tools.',
    );
  });

  it('says how a person adds a provider, where the server says, while there is none', () => {
    const setup = 'To add one, the person puts a key in the settings of the server.';

    expect(onThisServer({ providers: [], aliases: [] }, false, setup)).toMatch(/may name no tools\. To add one, /u);
    expect(onThisServer({ providers: ['anthropic'], aliases: [] }, false, setup)).not.toContain(setup);
    expect(onThisServer({ providers: [], aliases: ['house/fast'] }, false, setup)).not.toContain(setup);
  });
});
