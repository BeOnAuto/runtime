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

const servedWithLookup = await guideShelfFrom(guideFiles, [reasoning, lookup, interaction, workflow]);

const servedWithoutLookup = await guideShelfFrom(guideFiles, [reasoning, interaction, workflow]);

function giveToolsOf({ recipes }: GuideShelf): string {
  return recipes.find(({ name }) => name === 'give-tools')?.text ?? '';
}

describe('the recipe that gives a playbook tools, on a server that serves lookup functions', () => {
  it('sends what a tool marked reads returns to a lookup function, before what acts to an interaction function', () => {
    expect(giveToolsOf(servedWithLookup)).toContain(
      'and which of them it needs. To read what a tool marked reads returns, write a lookup function instead. To act on a system, write an interaction function',
    );
    expect(giveToolsOf(servedWithoutLookup)).not.toContain('lookup');
  });

  it('stays within the bound of a recipe with every addition, at 4,294 bytes', () => {
    const bytes = new TextEncoder().encode(giveToolsOf(servedWithLookup)).byteLength;

    expect([bytes, bytes <= mostRecipeBytes]).toEqual([4294, true]);
  });
});
