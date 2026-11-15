import { describe, expect, it } from 'vitest';

import { decodedEntry, problemsOf } from '../testing/entry-problems.ts';
import { messages } from '../testing/fixture-providers.ts';

function replacing(replaces: unknown) {
  return { ...messages, replaces };
}

describe('the providers an entry replaces', () => {
  it('are named by their names, and left out where it replaces none', () => {
    expect(decodedEntry(replacing(['chat', 'chat-bot'])).replaces).toEqual(['chat', 'chat-bot']);
    expect(decodedEntry(messages).replaces).toBeUndefined();
    expect(problemsOf(replacing(['chat']))).toEqual([]);
  });

  it('are at least one, each a provider’s name, never the entry’s own, each once', () => {
    expect(problemsOf(replacing([]))).toEqual([['/replaces', 'Expected a value with a length of at least 1']]);
    expect(problemsOf(replacing(['Chat', 'messages', 'chat', 'chat']))).toEqual([
      ['/replaces/0', 'Expected a name of 1 to 32 lowercase letters, digits and hyphens, starting with a letter'],
      ['/replaces/1', 'Expected another provider: a provider does not replace itself'],
      ['/replaces/3', 'Expected each provider once'],
    ]);
  });
});
