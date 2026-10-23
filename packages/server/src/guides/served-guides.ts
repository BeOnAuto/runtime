import type { DefinitionType, Guide, Recipe } from '@on.auto/api';
import type { Capability } from '@on.auto/definitions';
import { capitalized, type ShippedFiles } from '@on.auto/operations';

import { withLinksResolved } from './page-links.ts';
import { recipesFor } from './recipes.ts';
import { withoutSiteMarkup } from './site-markup.ts';
import { terminologyGuideOf } from './terminology-guide.ts';

export interface ServedGuides {
  readonly definitionTypes: readonly DefinitionType[];
  readonly guides: readonly Guide[];
  readonly recipes: readonly Recipe[];
}

const documentation = new URL('../../../../docs/', import.meta.url);

const terminologyPage = 'concepts/terminology.md';

function pageOfGuide(guide: string): string {
  return `reference/${guide.replace(/-function$/u, '')}-format.md`;
}

function pageText(shippedFiles: ShippedFiles, page: string): Promise<string> {
  return shippedFiles.text(new URL(page, documentation));
}

async function typeGuideOf(
  shippedFiles: ShippedFiles,
  { noun, guide }: Pick<Capability, 'noun' | 'guide'>,
): Promise<Guide> {
  const page = pageOfGuide(guide.name);
  const text = withLinksResolved(withoutSiteMarkup(await pageText(shippedFiles, page)), page);
  return {
    name: guide.name,
    title: `${capitalized(noun.one)} format`,
    description: `How ${noun.other} are written: their document, fields, examples and bounds.`,
    text: guide.onThisServer === undefined ? text : `${text.trimEnd()}\n\n${guide.onThisServer}\n`,
  };
}

export async function servedGuidesOf(
  shippedFiles: ShippedFiles,
  capabilities: readonly Capability[],
): Promise<ServedGuides> {
  const definitionTypes: readonly DefinitionType[] = capabilities.map(({ type, noun, guide }) => ({
    type,
    noun: noun.one,
    guide: guide.name,
  }));
  const guides = [
    terminologyGuideOf(
      await pageText(shippedFiles, terminologyPage),
      definitionTypes.map(({ noun }) => noun),
    ),
    ...(await Promise.all(capabilities.map(({ noun, guide }) => typeGuideOf(shippedFiles, { noun, guide })))),
  ];
  return { definitionTypes, guides, recipes: await recipesFor(shippedFiles, guides) };
}
