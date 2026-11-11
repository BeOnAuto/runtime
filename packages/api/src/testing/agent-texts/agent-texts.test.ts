import { createHash } from 'node:crypto';

import { defineQuery } from '@on.auto/operations';
import { Effect, Schema } from 'effect';
import { beforeAll, describe, expect, it } from 'vitest';

import { guideShelfOf, type Guide, type Recipe } from '../../index.ts';
import { noteRecipe, testDefinitionTypes, testGuides, testRecipes } from '../guides.ts';
import { notebookOperations, plainly } from '../notebook.ts';
import { agentTextsOf, type AgentText } from './agent-texts.ts';
import { surfaceServedBy } from './surfaces-served.ts';

function receivedAs(texts: readonly AgentText[]): readonly string[] {
  return texts.flatMap(({ received }) => received.map(({ as }) => as));
}

function textReceivedAs(texts: readonly AgentText[], as: string): AgentText | undefined {
  return texts.find(({ received }) => received.some((receipt) => receipt.as === as));
}

const tallying = defineQuery('playbook', {
  name: 'tally_notes',
  title: 'Tally notes',
  description: 'Counts the notes of the playbook. Use it to know how many there are. It answers the count.',
  route: { method: 'GET', path: '/tally' },
  inputSchema: Schema.Struct({ since: Schema.optionalKey(Schema.String.annotate({ description: 'The first day' })) }),
  outputSchema: Schema.Struct({ count: Schema.Number }),
  reasons: [],
  handle: () => Effect.succeed({ count: 0 }),
  plainLanguage: plainly('tally the notes'),
});

const tallyingLines = defineQuery('playbook', {
  name: 'tally_lines',
  title: 'Tally lines',
  description: 'Counts the lines given. Use it to know how many there are. It answers the count.',
  route: { method: 'POST', path: '/tally-lines' },
  inputSchema: Schema.Struct({
    lines: Schema.Array(Schema.Struct({ text: Schema.String.annotate({ description: 'What the line says' }) })),
  }),
  outputSchema: Schema.Struct({ count: Schema.Number }),
  reasons: [],
  handle: ({ lines }) => Effect.succeed({ count: lines.length }),
  plainLanguage: plainly('tally the lines'),
});

const tallyGuide: Guide = {
  name: 'tallies',
  title: 'Tallies',
  description: 'How notes are counted.',
  text: '# Tallies\n\nA tally counts the notes.\n',
};

const tallyRecipe: Recipe = {
  name: 'tally-the-notes',
  title: 'Tally the notes',
  description: 'Counts the notes and says how many.',
  text: '# Tally the notes\n\n1. Count them with tally_notes.\n',
  arguments: [],
  calls: ['tally_notes'],
  request: () => 'Tally the notes.',
};

async function listedWith(guide: Guide): Promise<readonly AgentText[]> {
  const shelf = guideShelfOf([...testGuides, guide], testRecipes, testDefinitionTypes);
  return agentTextsOf(await surfaceServedBy({ shelf }), []);
}

describe('a tool, a guide, a recipe or a prompt that a server starts to serve', () => {
  it('is in the list without anyone adding it to a list', async () => {
    const before = agentTextsOf(await surfaceServedBy({ operations: notebookOperations }), []);
    const shelf = guideShelfOf([...testGuides, tallyGuide], [...testRecipes, tallyRecipe], testDefinitionTypes);
    const after = agentTextsOf(await surfaceServedBy({ operations: [...notebookOperations, tallying], shelf }), []);

    expect(
      receivedAs(after)
        .filter((as) => !receivedAs(before).includes(as))
        .toSorted(),
    ).toEqual([
      'guide tallies',
      'guide tally-the-notes',
      'prompt tally-the-notes: description',
      'prompt tally-the-notes: message',
      'prompt tally-the-notes: title',
      'tool tally_notes: argument playbook',
      'tool tally_notes: argument since',
      'tool tally_notes: description',
      'tool tally_notes: title',
    ]);
  });

  it('changes the list where one word of what it serves changes', async () => {
    const before = await listedWith(tallyGuide);
    const after = await listedWith({ ...tallyGuide, text: '# Tallies\n\nA tally counts every note.\n' });

    expect(textReceivedAs(before, 'guide tallies')?.lines).toEqual(['# Tallies', '', 'A tally counts the notes.', '']);
    expect(textReceivedAs(after, 'guide tallies')?.lines).toEqual(['# Tallies', '', 'A tally counts every note.', '']);
    expect(textReceivedAs(after, 'guide tallies')?.sha256).not.toBe(textReceivedAs(before, 'guide tallies')?.sha256);
  });

  it('stops the list where its input schema holds a description the page at /debug does not show', async () => {
    const surface = await surfaceServedBy({ operations: [...notebookOperations, tallyingLines] });

    expect(() => agentTextsOf(surface, [])).toThrow(
      'The input schema of tally_lines holds a description that the page at /debug does not show',
    );
  });
});

describe('each text of the list', () => {
  let texts: readonly AgentText[];

  beforeAll(async () => {
    const firstCalls = [{ tool: 'list_notes', arguments: { playbook: 'alpha' } }];
    texts = agentTextsOf(await surfaceServedBy({ operations: notebookOperations }, firstCalls), ['notebook']);
  });

  it('is listed once, with every place it is received and the SHA-256 of its text', () => {
    const said =
      'Adds a note to the playbook. Use it when the person dictates one. `name` names it and `text` says it.';

    expect(textReceivedAs(texts, 'tool add_note: description')).toEqual({
      sha256: createHash('sha256').update(said, 'utf8').digest('hex'),
      tier: 1,
      received: [
        { as: 'tool add_note: description', on: ['/mcp', '/orgs/{org}/playbooks/{playbook}/mcp', '/directory'] },
      ],
      lines: [said],
    });
    expect(new Set(texts.map(({ sha256 }) => sha256)).size).toBe(texts.length);
  });

  it('is in tier 1 where every agent receives it: the instructions, and the title, description and arguments of each tool', () => {
    expect(textReceivedAs(texts, 'instructions')?.tier).toBe(1);
    expect(textReceivedAs(texts, 'tool list_notes: argument playbook')?.tier).toBe(1);
    expect(textReceivedAs(texts, 'tool add_note: title')?.tier).toBe(1);
  });

  it('is in tier 2 on the onboarding path: the first answers on a new org, and the guides and prompts named for it', () => {
    const firstAnswer = 'first answer of list_notes {"playbook":"alpha"}';

    expect(textReceivedAs(texts, firstAnswer)).toMatchObject({
      tier: 2,
      received: [{ as: firstAnswer, on: ['/mcp'] }],
      lines: ['Done: list the notes.'],
    });
    expect(textReceivedAs(texts, 'guide notebook')?.tier).toBe(2);
  });

  it('is in tier 3 otherwise', () => {
    expect(textReceivedAs(texts, 'guide terminology')?.tier).toBe(3);
    expect(textReceivedAs(texts, 'prompt take-a-note: title')?.tier).toBe(3);
  });
});

describe('a text received in two places of different tiers', () => {
  const attached = 'prompt take-a-note: attached guide://notebook';

  it('is one text that takes the higher tier, whichever place it is received in first', async () => {
    const surface = await surfaceServedBy({ operations: notebookOperations });
    const asThePrompt = agentTextsOf(surface, [noteRecipe.name]);
    const asTheGuide = agentTextsOf(surface, ['notebook']);

    expect(textReceivedAs(asThePrompt, attached)).toBe(textReceivedAs(asThePrompt, 'guide notebook'));
    expect(textReceivedAs(asThePrompt, 'guide notebook')?.tier).toBe(2);
    expect(textReceivedAs(asTheGuide, attached)?.tier).toBe(2);
  });
});
