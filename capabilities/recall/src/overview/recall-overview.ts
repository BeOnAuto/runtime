import {
  bulletList,
  eventFilterPhrases,
  paragraph,
  schemaBlocks,
  sectionOf,
  type Diagram,
  type OverviewBlock,
  type OverviewParts,
  type OverviewSection,
  type Phrases,
} from '@on.auto/definitions';
import { capitalized } from '@on.auto/operations';
import type { ViewFilter } from '@on.auto/workflow-host';
import type { Schema } from 'effect';

import type { RecallFunctionDefinitionDocument } from '../document/recall-document.ts';

const mostInitialCharacters = 300;

const anyOutput = 'Any output, which its document does not describe.';

function plainText(phrases: Phrases): string {
  return phrases.map((phrase) => (typeof phrase === 'string' ? phrase : Object.values(phrase).join(''))).join('');
}

function remembersSection(filters: readonly ViewFilter[]): OverviewSection {
  const once = filters.length > 1 ? [paragraph('It remembers an event that matches more than one of these once.')] : [];
  return sectionOf(
    'What it remembers',
    paragraph("It remembers, from the first event of the playbook's history on:"),
    bulletList(filters.map((filter) => ['each time ', ...eventFilterPhrases(filter)])),
    ...once,
  );
}

function isEmpty(value: Schema.Json): boolean {
  return value === null || value === '' || (typeof value === 'object' && Object.keys(value).length === 0);
}

function initialBlocks(initial: Schema.Json): readonly OverviewBlock[] {
  if (isEmpty(initial)) {
    return [];
  }
  const written = JSON.stringify(initial);
  return written.length > mostInitialCharacters
    ? [
        paragraph(
          'Before the first event, the view is the value of ',
          { code: 'view.initial' },
          ', shown under Source.',
        ),
      ]
    : [paragraph('Before the first event, the view is ', { code: written }, '.')];
}

function keepsSection({ details }: RecallFunctionDefinitionDocument): OverviewSection {
  return sectionOf(
    'What it keeps',
    paragraph('It keeps one view, which its program updates with each event it remembers:'),
    ...schemaBlocks(details.schema, 'Any value, which its document does not describe.'),
    ...initialBlocks(details.initial),
  );
}

function answerBlocks({ output, answers }: RecallFunctionDefinitionDocument): readonly OverviewBlock[] {
  if (answers) {
    return [
      paragraph('It answers with what its program makes of the view and that input:'),
      ...schemaBlocks(output.schema?.document, anyOutput),
    ];
  }
  const checked = output.schema === undefined ? [] : schemaBlocks(output.schema.document, anyOutput);
  return [paragraph('It answers with the view itself, as it stands.'), ...checked];
}

function answersSection(document: RecallFunctionDefinitionDocument): OverviewSection {
  return sectionOf(
    'What it answers',
    paragraph('Each run takes:'),
    ...schemaBlocks(document.input.schema?.document, 'Any input, which its document does not describe.'),
    ...answerBlocks(document),
  );
}

function diagramOf(filters: readonly ViewFilter[], answers: boolean): Diagram {
  const view = filters.length;
  return {
    kind: 'diagram',
    nodes: [
      ...filters.map((filter) => ({ label: capitalized(plainText(eventFilterPhrases(filter))) })),
      { label: 'The view', shape: 'cylinder' },
      { label: answers ? 'The answer of a run' : 'The answer of a run, the view itself' },
    ],
    edges: [...filters.map((_, index) => ({ from: index, to: view })), { from: view, to: view + 1 }],
  };
}

function keptSection({ details, answers }: RecallFunctionDefinitionDocument): OverviewSection {
  return sectionOf(
    'How it is kept',
    diagramOf(details.filters, answers),
    paragraph(
      "Its view is built from the first event of the playbook's history when the function is saved, and again whenever it changes, and is kept up to date as the events it remembers arrive.",
    ),
    paragraph(
      'The program, its ',
      { code: 'fold' },
      ...(answers ? [' and its ', { code: 'answer' }] : []),
      ', is TypeScript and is shown under Source.',
    ),
  );
}

export function recallOverview(document: RecallFunctionDefinitionDocument): OverviewParts {
  return {
    body: [],
    sections: [
      remembersSection(document.details.filters),
      keepsSection(document),
      answersSection(document),
      keptSection(document),
    ],
    appendix: [],
  };
}
