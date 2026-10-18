import {
  describedSchemaBlocks,
  named,
  paragraph,
  schemaBlocks,
  sectionOf,
  theToolOf,
  undescribedSentence,
  type OverviewSection,
  type Phrase,
  type Phrases,
} from '@on.auto/definitions';
import { JsonPointer } from 'effect';

import type { CallDocument } from '../document/interaction-document.ts';

function readPhrases(read: string | undefined): Phrases {
  const segments = (read ?? '')
    .split('/')
    .slice(1)
    .map((segment) => JsonPointer.unescapeToken(segment));
  if (segments.length === 0) {
    return ['It answers with the whole of what the tool answered:'];
  }
  const under: Phrase[] = [];
  for (const [index, segment] of segments.entries()) {
    under.push(...(index === 0 ? [] : [', then ']), named(segment));
  }
  return ['It answers with what the tool answered under ', ...under, ':'];
}

export function callSections({ call, input, output }: CallDocument): readonly OverviewSection[] {
  return [
    sectionOf('Who it asks', paragraph('It asks a system: each run calls ', ...theToolOf(call), ' once.')),
    sectionOf(
      'What it sends',
      paragraph("It sends the tool the arguments its document writes, from each run's input:"),
      ...schemaBlocks(input.schema?.document, undescribedSentence('input')),
    ),
    sectionOf('What it reads', paragraph(...readPhrases(call.read)), ...describedSchemaBlocks(output.schema.document)),
  ];
}
