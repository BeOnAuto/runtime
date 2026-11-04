import { inDefinitionTypeOrder } from '@on.auto/definitions';
import { capitalized, type Noun } from '@on.auto/phrasing';
import { shippedFileIn, type ShippedFiles } from '@on.auto/shipped-files';

import type { DefinitionType } from '../mcp/instructions.ts';
import { documentation } from './guide-files.ts';
import { guideShelfOf, pageGuideName, type Guide, type GuideShelf } from './guide-shelf.ts';
import { withLinksResolved } from './page-links.ts';
import { recipesFor } from './recipes.ts';
import { withoutSiteMarkup } from './site-markup.ts';
import { terminologyGuideOf } from './terminology-guide.ts';

export interface ServedType {
  readonly type: string;
  readonly noun: Noun;
  readonly guide: { readonly name: string; readonly onThisServer?: string };
}

const terminologyPage = 'concepts/terminology.md';

const templatesPage = 'reference/template.md';

const templatesAbout: Omit<Guide, 'text'> = {
  name: 'templates',
  title: 'Templates',
  description: 'The filters a template may use, the same in every template of every definition.',
};

const pagePage = 'reference/page-format.md';

const pageAbout: Omit<Guide, 'text'> = {
  name: pageGuideName,
  title: 'Page format',
  description:
    'How a workflow, a function or the playbook shows its results, run by run and over time: the page document, its views, templates and bounds.',
};

interface ServedPages {
  readonly pages: boolean;
}

function pageOfGuide(guide: string): string {
  return `reference/${guide.replace(/-function$/u, '')}-format.md`;
}

function pageText(shippedFiles: ShippedFiles, page: string): Promise<string> {
  return shippedFiles.text(shippedFileIn(documentation, page));
}

async function pageGuideOf(shippedFiles: ShippedFiles, page: string, about: Omit<Guide, 'text'>): Promise<Guide> {
  return { ...about, text: withLinksResolved(withoutSiteMarkup(await pageText(shippedFiles, page)), page) };
}

async function typeGuideOf(
  shippedFiles: ShippedFiles,
  { noun, guide }: Pick<ServedType, 'noun' | 'guide'>,
): Promise<Guide> {
  const { text, ...about } = await pageGuideOf(shippedFiles, pageOfGuide(guide.name), {
    name: guide.name,
    title: `${capitalized(noun.one)} format`,
    description: `How ${noun.other} are written: their document, fields, examples and bounds.`,
  });
  return { ...about, text: guide.onThisServer === undefined ? text : `${text.trimEnd()}\n\n${guide.onThisServer}\n` };
}

export async function guideShelfFrom(
  shippedFiles: ShippedFiles,
  served: readonly ServedType[],
  { pages }: ServedPages,
): Promise<GuideShelf> {
  const types = inDefinitionTypeOrder(served);
  const definitionTypes: readonly DefinitionType[] = types.map(({ type, noun, guide }) => ({
    type,
    noun: noun.one,
    guide: guide.name,
  }));
  const guides = [
    terminologyGuideOf(
      await pageText(shippedFiles, terminologyPage),
      definitionTypes.map(({ noun }) => noun),
    ),
    ...(await Promise.all(types.map(({ noun, guide }) => typeGuideOf(shippedFiles, { noun, guide })))),
    await pageGuideOf(shippedFiles, templatesPage, templatesAbout),
    ...(pages ? [await pageGuideOf(shippedFiles, pagePage, pageAbout)] : []),
  ];
  return guideShelfOf(guides, await recipesFor(shippedFiles, guides), definitionTypes);
}
