import { asSentence, type Noun } from '@on.auto/operations';
import type { Schema } from 'effect';

import { undescribedSentence } from '../overview-words/value-words.ts';
import type { OutputShape } from '../shapes/output-shape.ts';
import { shapeBlocks } from '../shapes/shape-words.ts';
import { firstParagraphOf } from './markdown-text.ts';
import { authoredText, sectionOf, type Overview, type OverviewBlock, type OverviewSection } from './overview.ts';
import { schemaBlocks } from './schema-words.ts';

export type OverviewParts = Pick<Overview, 'body' | 'sections' | 'appendix'>;

export type ToldParts = Pick<Overview, 'body' | 'appendix'>;

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
  readonly parts?: OverviewParts | ToldParts | undefined;
}

function inputBlocks(schema: Schema.JsonObject | undefined): readonly OverviewBlock[] {
  return schemaBlocks(schema, undescribedSentence('input'));
}

function outputBlocks(schema: Schema.JsonObject | undefined, shape: OutputShape | undefined): readonly OverviewBlock[] {
  return shape === undefined ? schemaBlocks(schema, undescribedSentence('output')) : shapeBlocks(shape);
}

export function inputSection(schema?: Schema.JsonObject): OverviewSection {
  return sectionOf('What it needs', ...inputBlocks(schema));
}

export function outputSection(schema?: Schema.JsonObject, shape?: OutputShape): OverviewSection {
  return sectionOf('What it produces', ...outputBlocks(schema, shape));
}

export function inputDetails(schema?: Schema.JsonObject): OverviewSection {
  return sectionOf('Input', ...inputBlocks(schema));
}

export function outputDetails(schema?: Schema.JsonObject, shape?: OutputShape): OverviewSection {
  return sectionOf('Output', ...outputBlocks(schema, shape));
}

function isDescribed(description: string | undefined): description is string {
  return description !== undefined && description.trim() !== '';
}

function openingOf(description: string | undefined, noun: Noun): string {
  return isDescribed(description) ? description : `This ${noun.one} has no description yet.`;
}

function toldOpeningOf(description: string | undefined, noun: Noun): string {
  if (!isDescribed(description)) {
    return openingOf(description, noun);
  }
  const trimmed = description.trim();
  const { text, endsInProse } = firstParagraphOf(trimmed);
  return text === trimmed && endsInProse ? asSentence(trimmed) : description;
}

function aboutBlocks(about: string | undefined): readonly OverviewBlock[] {
  const written = about?.replace(leadingBlankLines, '').trimEnd();
  return written === undefined || written === '' ? [] : [authoredText(written)];
}

function typeWideParts({ inputSchema, outputSchema }: OverviewSubject): OverviewParts {
  return { body: [], sections: [inputSection(inputSchema), outputSection(outputSchema)], appendix: [] };
}

function sectionedOf(parts: OverviewParts | ToldParts): OverviewParts | undefined {
  return 'sections' in parts ? parts : undefined;
}

export function composedOverview({ name, noun, summary, parts = typeWideParts(summary) }: OverviewRequest): Overview {
  const sectioned = sectionedOf(parts);
  return {
    title: name,
    opening: [
      sectioned === undefined ? toldOpeningOf(summary.description, noun) : openingOf(summary.description, noun),
    ],
    body: [...aboutBlocks(summary.about), ...parts.body],
    sections: sectioned?.sections ?? [],
    appendix: parts.appendix,
  };
}
