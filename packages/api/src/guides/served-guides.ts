import { inDefinitionTypeOrder, type CapabilityGuide } from '@on.auto/definitions';
import { capitalized, type Noun } from '@on.auto/phrasing';
import { shippedFileIn, type ShippedFiles } from '@on.auto/shipped-files';

import { documentation } from './guide-files.ts';
import {
  eventsGuideName,
  guideShelfOf,
  pageGuideName,
  type DefinitionType,
  type Guide,
  type GuideShelf,
} from './guide-shelf.ts';
import { withLinksResolved } from './page-links.ts';
import { recipesFor } from './recipes.ts';
import { withoutSiteMarkup } from './site-markup.ts';
import { startGuideOf } from './start-guide.ts';
import { terminologyGuideOf } from './terminology-guide.ts';

export interface ServedType {
  readonly type: string;
  readonly noun: Noun;
  readonly guide: CapabilityGuide;
}

const terminologyPage = 'concepts/terminology.md';

const templatesPage = 'reference/template.md';

const templatesAbout: Omit<Guide, 'text'> = {
  name: 'templates',
  title: 'Templates',
  description: 'The filters a template may use, the same in every template of every definition.',
};

const triggersPage = 'reference/triggers.md';

const triggersAbout: Omit<Guide, 'text'> = {
  name: 'triggers',
  title: 'Triggers',
  description:
    'How a workflow starts on its own: the triggers of its schedule, on an event, at set times or every so often, and their limits.',
};

const eventsPage = 'reference/events.md';

const eventsAbout: Omit<Guide, 'text'> = {
  name: eventsGuideName,
  title: 'Events',
  description:
    "The playbook's events that a workflow's trigger, a page and a prediction function take, and how a filter names them.",
};

const typesTakingEvents: ReadonlySet<string> = new Set(['workflow', 'prediction']);

const pagePage = 'reference/page-format.md';

const pageAbout: Omit<Guide, 'text'> = {
  name: pageGuideName,
  title: 'Page format',
  description:
    'How a workflow, a function or the playbook shows its results, run by run and over time: the page document, its views, templates and bounds.',
};

const glancePage = 'reference/glance-format.md';

const glanceAbout: Omit<Guide, 'text'> = {
  name: 'glance',
  title: 'Glance format',
  description:
    "What a workflow says about itself in a fixed shape, its page's glance: its headline, visual and outstanding items.",
};

interface CompanionGuide {
  readonly type: string;
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly page: string;
}

interface ServedOptions {
  readonly pages: boolean;
  readonly companions?: readonly CompanionGuide[];
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
  companions: readonly CompanionGuide[],
): Promise<readonly Guide[]> {
  const { text, ...about } = await pageGuideOf(shippedFiles, pageOfGuide(guide.name), {
    name: guide.name,
    title: `${capitalized(noun.one)} format`,
    description: `How ${noun.other} are written: their document, fields, examples and bounds.`,
  });
  const typeGuide = {
    ...about,
    text: guide.onThisServer === undefined ? text : `${text.trimEnd()}\n\n${guide.onThisServer}\n`,
  };
  const companionGuides = await Promise.all(
    companions.map(({ page, name, title, description }) =>
      pageGuideOf(shippedFiles, page, { name, title, description }),
    ),
  );
  return [typeGuide, ...companionGuides];
}

export async function guideShelfFrom(
  shippedFiles: ShippedFiles,
  served: readonly ServedType[],
  { pages, companions = [] }: ServedOptions,
): Promise<GuideShelf> {
  const types = inDefinitionTypeOrder(served);
  const companionsOf = (type: string): readonly CompanionGuide[] =>
    companions.filter((companion) => companion.type === type);
  const definitionTypes: readonly DefinitionType[] = types.map(({ type, noun, guide }) => ({
    type,
    noun: noun.one,
    guide: guide.name,
  }));
  const workflows = types.some(({ type }) => type === 'workflow');
  const events = pages || types.some(({ type }) => typesTakingEvents.has(type));
  const pageGuides = [
    terminologyGuideOf(
      await pageText(shippedFiles, terminologyPage),
      definitionTypes.map(({ noun }) => noun),
    ),
    ...(
      await Promise.all(
        types.map(({ type, noun, guide }) => typeGuideOf(shippedFiles, { noun, guide }, companionsOf(type))),
      )
    ).flat(),
    await pageGuideOf(shippedFiles, templatesPage, templatesAbout),
    ...(workflows ? [await pageGuideOf(shippedFiles, triggersPage, triggersAbout)] : []),
    ...(events ? [await pageGuideOf(shippedFiles, eventsPage, eventsAbout)] : []),
    ...(pages
      ? [await pageGuideOf(shippedFiles, pagePage, pageAbout), await pageGuideOf(shippedFiles, glancePage, glanceAbout)]
      : []),
  ];
  const recipes = await recipesFor(shippedFiles, pageGuides, definitionTypes);
  const cards = types.some(({ type }) => companionsOf(type).length > 0);
  const start = startGuideOf({ definitionTypes, pages, events, cards, recipes: recipes.map(({ name }) => name) });
  return guideShelfOf([start, ...pageGuides], recipes, definitionTypes);
}
