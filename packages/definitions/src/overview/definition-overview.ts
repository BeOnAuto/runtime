import type { Noun } from '@on.auto/operations';
import type { Schema } from 'effect';

import { undescribedSentence } from '../overview-words/value-words.ts';
import type { OutputShape } from '../shapes/output-shape.ts';
import { shapeBlocks } from '../shapes/shape-words.ts';
import { authoredText, sectionOf, type Overview, type OverviewBlock, type OverviewSection } from './overview.ts';
import { schemaBlocks } from './schema-words.ts';

export type OverviewParts = Pick<Overview, 'body' | 'sections' | 'appendix'>;

const leadingBlankLines = /^(?:[ \t]*\n)+/u;

interface OverviewSubject {
  readonly description?: string;
  readonly about?: string;
  readonly inputSchema?: Schema.JsonObject;
  readonly outputSchema?: Schema.JsonObject;
}

interface OverviewRequest {
  readonly name: string;
  readonly noun: Noun;
  readonly summary: OverviewSubject;
  readonly parts?: OverviewParts | undefined;
}

export function inputSection(schema?: Schema.JsonObject): OverviewSection {
  return sectionOf('What it needs', ...schemaBlocks(schema, undescribedSentence('input')));
}

export function outputSection(schema?: Schema.JsonObject, shape?: OutputShape): OverviewSection {
  return sectionOf(
    'What it produces',
    ...(shape === undefined ? schemaBlocks(schema, undescribedSentence('output')) : shapeBlocks(shape)),
  );
}

function openingOf(description: string | undefined, noun: Noun): string {
  return description === undefined || description.trim() === ''
    ? `This ${noun.one} has no description yet.`
    : description;
}

function aboutBlocks(about: string | undefined): readonly OverviewBlock[] {
  const written = about?.replace(leadingBlankLines, '').trimEnd();
  return written === undefined || written === '' ? [] : [authoredText(written)];
}

function typeWideParts({ inputSchema, outputSchema }: OverviewSubject): OverviewParts {
  return { body: [], sections: [inputSection(inputSchema), outputSection(outputSchema)], appendix: [] };
}

export function composedOverview({ name, noun, summary, parts }: OverviewRequest): Overview {
  const { body, sections, appendix } = parts ?? typeWideParts(summary);
  return {
    title: name,
    opening: [openingOf(summary.description, noun)],
    body: [...aboutBlocks(summary.about), ...body],
    sections,
    appendix,
  };
}
