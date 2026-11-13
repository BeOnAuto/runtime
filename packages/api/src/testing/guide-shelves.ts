import { defineCapability, type Capability, type CapabilityGuide } from '@on.auto/definitions';
import { echoDeclaration } from '@on.auto/definitions/testing';
import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';

import type { GuideShelf } from '../guides/guide-shelf.ts';
import { guideShelfFrom } from '../guides/served-guides.ts';
import { apiShippedRoots } from '../shipped-files/api-roots.ts';

export const guideFiles = shippedFilesOnDisk(apiShippedRoots());

function capabilityOf(name: string, noun: string, guide: CapabilityGuide): Capability {
  return defineCapability({
    ...echoDeclaration,
    type: name,
    title: noun,
    guide,
    noun: { one: noun, other: `${noun}s` },
  });
}

export const onThisServer = 'On this server, a reasoning function names its model through anthropic.';

const reasoning = capabilityOf('reasoning', 'reasoning function', { name: 'reasoning-function', onThisServer });

const computation = capabilityOf('computation', 'computation function', { name: 'computation-function' });

const prediction = capabilityOf('prediction', 'prediction function', { name: 'prediction-function' });

const workflow = capabilityOf('workflow', 'workflow', { name: 'workflow' });

const everyType = [reasoning, computation, prediction, workflow];

const interaction = capabilityOf('interaction', 'interaction function', { name: 'interaction-function' });

const cards = {
  type: 'interaction',
  name: 'render-slack',
  title: 'Cards for Slack',
  description: 'How to write a message to Slack as a card.',
  page: 'reference/render-slack.md',
};

export const served = await guideShelfFrom(guideFiles, everyType, { pages: false });

export const servedWithInteraction = await guideShelfFrom(guideFiles, [...everyType, interaction], { pages: false });

export const servedWithCards = await guideShelfFrom(guideFiles, [...everyType, interaction], {
  pages: false,
  companions: [cards],
});

export const servedForReasoningAndWorkflows = await guideShelfFrom(guideFiles, [reasoning, workflow], { pages: false });

export const servedForReasoning = await guideShelfFrom(guideFiles, [reasoning], { pages: false });

export const servedWithEverything = await guideShelfFrom(guideFiles, [...everyType, interaction], { pages: true });

const lookup = capabilityOf('lookup', 'lookup function', { name: 'lookup-function' });

export const servedWithLookupAndPages = await guideShelfFrom(guideFiles, [reasoning, lookup, workflow], {
  pages: true,
});

export function recipeTextsOf({ recipes }: GuideShelf): Readonly<Record<string, string>> {
  return Object.fromEntries(recipes.map(({ name, text }) => [name, text]));
}

export function byteLengthOf(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

export function bytesOf(texts: Readonly<Record<string, string>>, ...names: readonly string[]): readonly number[] {
  return names.map((name) => byteLengthOf(String(texts[name])));
}
