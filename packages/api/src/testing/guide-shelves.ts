import { defineCapability, type Capability, type CapabilityGuide, type GuideVariables } from '@on.auto/definitions';
import { echoDeclaration } from '@on.auto/definitions/testing';
import { changedOnlyByWhoeverRunsTheServer } from '@on.auto/phrasing';
import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';

import type { GuideShelf } from '../guides/guide-shelf.ts';
import { guideShelfFrom } from '../guides/served-guides.ts';
import { apiShippedRoots } from '../shipped-files/api-roots.ts';

export const guideFiles = shippedFilesOnDisk(apiShippedRoots());

const valuesThePagesName: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'computation-function': {
    'computation.most_memory': '256 MiB',
    'computation.bounds_changed_by': 'are fixed on this server',
  },
  'interaction-function': {
    'interaction.most_call_arguments': '16 MiB',
    'interaction.most_open_requests': '10,000 at once',
    'interaction.bounds_changed_by': changedOnlyByWhoeverRunsTheServer,
  },
  'lookup-function': {
    'lookup.most_call_arguments': '16 MiB',
    'lookup.bounds_changed_by': changedOnlyByWhoeverRunsTheServer,
  },
  workflow: {
    'workflow.longest_run': '30 days from its start',
    'workflow.bounds_changed_by': changedOnlyByWhoeverRunsTheServer,
  },
};

function asThePageWritesThem(values: Readonly<Record<string, string>>): GuideVariables {
  return Object.fromEntries(
    Object.entries(values).map(([value, words]: readonly [string, string]) => [
      value,
      { value: words, default: words },
    ]),
  );
}

export const valuesOfThePages: GuideVariables = asThePageWritesThem(
  Object.fromEntries(Object.values(valuesThePagesName).flatMap((values) => Object.entries(values))),
);

export function guideOfThePage(name: string, onThisServer?: string): CapabilityGuide {
  const values = valuesThePagesName[name];
  return {
    name,
    ...(onThisServer === undefined ? {} : { onThisServer }),
    ...(values === undefined ? {} : { variables: asThePageWritesThem(values) }),
  };
}

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

const reasoning = capabilityOf('reasoning', 'reasoning function', guideOfThePage('reasoning-function', onThisServer));

const computation = capabilityOf('computation', 'computation function', guideOfThePage('computation-function'));

const prediction = capabilityOf('prediction', 'prediction function', guideOfThePage('prediction-function'));

const workflow = capabilityOf('workflow', 'workflow', guideOfThePage('workflow'));

const everyType = [reasoning, computation, prediction, workflow];

const interaction = capabilityOf('interaction', 'interaction function', guideOfThePage('interaction-function'));

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

export const everyTypeAndInteraction = [...everyType, interaction];

export const servedWithEverything = await guideShelfFrom(guideFiles, everyTypeAndInteraction, { pages: true });

export const servedWithEverythingAndGoals = await guideShelfFrom(guideFiles, [...everyType, interaction], {
  pages: true,
  goals: true,
  messages: true,
});

export const servedWithEverythingAndGoalsUntold = await guideShelfFrom(guideFiles, [...everyType, interaction], {
  pages: true,
  goals: true,
});

const lookup = capabilityOf('lookup', 'lookup function', guideOfThePage('lookup-function'));

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
