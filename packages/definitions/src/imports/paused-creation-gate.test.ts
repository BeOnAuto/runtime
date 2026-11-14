import { defineCommand } from '@on.auto/operations';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineCapability } from '../capability/capability.ts';
import { contributesWantedWords } from '../contributions/contribution-words.ts';
import { savedPage, savePlaybook } from '../exporting/playbook-saving.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { harness, toPlaybook } from '../testing/harness.ts';
import { uncheckedPages } from '../testing/page-ports.ts';
import { definitionCreatedPaused } from './paused-creation.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const decodedDocument = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ steps: Schema.Number, contributes: Schema.optionalKey(Schema.Json) })),
);

const contributing = defineCapability({
  type: 'workflow',
  title: 'Workflow',
  guide: { name: 'workflow' },
  noun: { one: 'workflow', other: 'workflows' },
  describeOutput: () => 'It ran.',
  mediaType: 'application/json',
  parse: (source: string) => Effect.orDie(decodedDocument(source)),
  summarize: ({ contributes }) => (contributes === undefined ? {} : { details: { contributes } }),
  run: () => Effect.succeed({ output: {}, record: {} }),
});

const goals = [
  '- id: orders',
  '  statement: Answer every order the same day.',
  '  success:',
  '    label: Orders answered',
  '    settles: on_crossing',
  '    target: { at_least: 1 }',
  '    passed: Answered',
  '    failed: Missed',
  '  notify: { passed: quiet, failed: quiet }',
  '',
].join('\n');

const createPaused = defineCommand('playbook', {
  name: 'create_paused',
  title: 'Create paused',
  description: 'Creates a definition paused, as an import does.',
  route: { method: 'POST', path: '/create-paused' },
  inputSchema: Schema.Struct({ type: Schema.String, name: Schema.String, source: Schema.String }),
  outputSchema: Schema.Struct({ name: Schema.String }),
  reasons: ['invalid_input', 'conflict', 'not_found', 'unavailable'],
  handle: (input) =>
    Effect.map(definitionCreatedPaused([contributing], uncheckedPages, true)(input), ({ name }) => ({ name })),
});

const workflow = (name: string, contributes?: unknown) => ({
  type: 'workflow',
  name,
  source: JSON.stringify(contributes === undefined ? { steps: 1 } : { steps: 1, contributes }),
});

describe('a workflow created paused where goals are kept, as an import copies it', () => {
  it('meets the gate a save meets: refused without contributes, made when it contributes to a goal', async () => {
    const definitions = harness();
    await definitions.call(savePlaybook, toAlpha(acmeAdmin, { page: savedPage, goals }));

    expect(await definitions.call(createPaused, toAlpha(acmeAdmin, workflow('silent')))).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      detail: contributesWantedWords,
    });
    expect(
      await definitions.call(
        createPaused,
        toAlpha(acmeAdmin, workflow('answering', [{ goal: 'orders', purpose: 'Answers each order.' }])),
      ),
    ).toMatchObject({ status: 'succeeded', output: { name: 'answering' } });
  });
});
