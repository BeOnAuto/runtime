import { InvalidInput } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { readReasoningFunctionDefinition } from '../index.ts';
import { documentOf, reasoningExample } from '../testing/definition-documents.ts';

describe('the reader of a reasoning function definition', () => {
  it('reads a source into the document every step function of a shell takes, as the capability reads it', async () => {
    const definition = await Effect.runPromise(readReasoningFunctionDefinition(reasoningExample));

    expect([definition.model, definition.settings.max_output_tokens, definition.output.type, definition.tools]).toEqual(
      ['anthropic/claude-sonnet-4-5', 800, 'json', []],
    );
  });

  it('refuses a source that is no definition, with its issues, as saving it refuses it', async () => {
    const refused = await Effect.runPromise(Effect.flip(readReasoningFunctionDefinition(documentOf('model: 7'))));

    expect(refused).toBeInstanceOf(InvalidInput);
    expect(refused.detail).toMatch(/^The reasoning function definition has /u);
    expect(refused.issues?.length).toBeGreaterThan(0);
  });
});
