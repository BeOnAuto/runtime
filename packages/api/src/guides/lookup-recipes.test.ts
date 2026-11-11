import { defineCapability, type Capability, type CapabilityGuide } from '@on.auto/definitions';
import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { apiShippedRoots, mostRecipeBytes, type GuideShelf } from '../index.ts';
import { guideShelfFrom } from './served-guides.ts';

const guideFiles = shippedFilesOnDisk(apiShippedRoots());

function capabilityOf(name: string, noun: string, guide: CapabilityGuide): Capability {
  return defineCapability({
    type: name,
    title: noun,
    guide,
    noun: { one: noun, other: `${noun}s` },
    describeOutput: () => 'It ran.',
    mediaType: 'text/markdown',
    parse: () => Effect.succeed({}),
    summarize: () => ({}),
    run: () => Effect.succeed({ output: null, record: {} }),
  });
}

const reasoning = capabilityOf('reasoning', 'reasoning function', { name: 'reasoning-function' });

const lookup = capabilityOf('lookup', 'lookup function', { name: 'lookup-function' });

const interaction = capabilityOf('interaction', 'interaction function', { name: 'interaction-function' });

const workflow = capabilityOf('workflow', 'workflow', { name: 'workflow' });

const servedWithLookup = await guideShelfFrom(guideFiles, [reasoning, lookup, interaction, workflow], { pages: false });

const servedWithoutLookup = await guideShelfFrom(guideFiles, [reasoning, interaction, workflow], { pages: false });

const servedWithLookupAndPages = await guideShelfFrom(guideFiles, [reasoning, lookup, interaction, workflow], {
  pages: true,
});

function recipeNamesOf({ recipes }: GuideShelf): readonly string[] {
  return recipes.map(({ name }) => name);
}

function keepOf({ recipes }: GuideShelf): string {
  return recipes.find(({ name }) => name === 'keep')?.text ?? '';
}

function giveToolsOf({ recipes }: GuideShelf): string {
  return recipes.find(({ name }) => name === 'give-tools')?.text ?? '';
}

describe('the recipe that gives a playbook tools, on a server that serves lookup functions', () => {
  it('sends a read the job always makes to a lookup function, before an act to an interaction function', () => {
    expect(giveToolsOf(servedWithLookup)).toContain(
      "4. Ask the person what the playbook should do with the tools, and give each use its function:\n   - a read the job always makes, by a tool marked reads: a lookup function, whose `call` names the `server` and the `tool`, with its arguments in `with`, written from the run's input. One lookup function for each read.\n   - an act on a system,",
    );
    expect(giveToolsOf(servedWithoutLookup)).not.toContain('lookup');
  });

  it('stays within the bound of a recipe, at 4,094 bytes', () => {
    const bytes = new TextEncoder().encode(giveToolsOf(servedWithLookup)).byteLength;

    expect([bytes, bytes <= mostRecipeBytes]).toEqual([4094, true]);
  });
});

describe('the keep recipe', () => {
  it('is offered, after the others, on a server that serves lookup functions, and not on one that serves none', () => {
    expect([recipeNamesOf(servedWithLookup), recipeNamesOf(servedWithoutLookup)]).toEqual([
      ['first-playbook', 'connect-a-service', 'give-tools', 'schedule', 'keep'],
      ['first-playbook', 'connect-a-service', 'give-tools', 'schedule'],
    ]);
  });

  it('stays within the bound of a recipe with its page, at 2,093 bytes', () => {
    const bytes = new TextEncoder().encode(keepOf(servedWithLookupAndPages)).byteLength;

    expect([bytes, bytes <= mostRecipeBytes]).toEqual([2093, true]);
  });
});
