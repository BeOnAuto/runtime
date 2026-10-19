import { paragraph, sectionOf, type OverviewSection, type Paragraph } from '../overview/overview.ts';
import type { JsonSchema } from '../overview/schema-reading.ts';
import type { OutputShape } from '../shapes/output-shape.ts';
import { answeredWords, givenClause } from './field-sentences.ts';

type ProgramLanguage = 'typescript';

interface Computed {
  readonly input?: JsonSchema | undefined;
  readonly output?: JsonSchema | undefined;
  readonly shape?: OutputShape | undefined;
}

const languageNames: Readonly<Record<ProgramLanguage, string>> = { typescript: 'TypeScript' };

export function computedSentence({ input, output, shape }: Computed): Paragraph {
  return paragraph(
    ...givenClause(input),
    ', and a program works out the answer, the same every time for the same input: ',
    ...answeredWords(output, shape),
    '.',
  );
}

export function programSection(language: ProgramLanguage): OverviewSection {
  return sectionOf('Program', paragraph(`${languageNames[language]}, in the definition's document.`));
}
