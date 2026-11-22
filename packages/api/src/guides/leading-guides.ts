import type { GuideVariables } from '@on.auto/definitions';
import { shippedFileIn, type ShippedFiles } from '@on.auto/shipped-files';

import type { GuidePages } from '../guide-pages/guide-pages.ts';
import { goalsGuideIn } from './goals-guide-renditions.ts';
import { documentation, goalsGuideFile } from './guide-files.ts';
import { goalsGuideName, type Guide } from './guide-shelf.ts';
import { terminologyGuideOf } from './terminology-guide.ts';

const terminologyPage = 'concepts/terminology.md';

const goalsDescription = {
  told: 'What a playbook should achieve for the person, how they will know it worked, and what they want to be told about, and where.',
  untold: 'What a playbook should achieve for the person and how they will know it worked.',
};

interface GoalsKept {
  readonly goals: boolean;
  readonly messages: boolean;
}

async function goalsGuideOf(shippedFiles: ShippedFiles, messages: boolean): Promise<Guide> {
  return {
    name: goalsGuideName,
    title: 'Goals',
    description: messages ? goalsDescription.told : goalsDescription.untold,
    text: goalsGuideIn(await shippedFiles.text(goalsGuideFile), { messages }),
  };
}

interface Reading {
  readonly shippedFiles: ShippedFiles;
  readonly variables: GuideVariables;
  readonly renditions: GuidePages;
}

export async function leadingGuidesOf(
  { shippedFiles, variables, renditions }: Reading,
  nouns: readonly string[],
  kept: GoalsKept,
): Promise<readonly Guide[]> {
  const page = await shippedFiles.text(shippedFileIn(documentation, terminologyPage));
  const terminology = terminologyGuideOf(renditions.forTheAgent(terminologyPage, page, variables), nouns, kept);
  return kept.goals ? [terminology, await goalsGuideOf(shippedFiles, kept.messages)] : [terminology];
}
