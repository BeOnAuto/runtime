import {
  bulletList,
  charactersIn,
  describedSchemaBlocks,
  eventFilterPhrases,
  paragraph,
  plainTextOf,
  schemaBlocks,
  sectionOf,
  shownUnderSource,
  undescribedSentence,
  type Diagram,
  type OverviewBlock,
  type OverviewParts,
  type OverviewSection,
} from '@on.auto/definitions';
import { capitalized } from '@on.auto/operations';
import type { ViewFilter } from '@on.auto/workflow-host';
import type { Schema } from 'effect';

import type { RecallFunctionDefinitionDocument } from '../document/recall-document.ts';

const mostInitialViewCharacters = 300;

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
  return charactersIn(written) > mostInitialViewCharacters
    ? [shownUnderSource('value', 'Before the first event, the view is the value of ', { code: 'view.initial' })]
    : [paragraph('Before the first event, the view is ', { code: written }, '.')];
}

function keepsSection({ details }: RecallFunctionDefinitionDocument): OverviewSection {
  return sectionOf(
    'What it keeps',
    paragraph('It keeps one view, which its program updates with each event it remembers:'),
    ...schemaBlocks(details.schema, undescribedSentence('value', 'alone')),
    ...initialBlocks(details.initial),
  );
}

function answerBlocks({ output, answers }: RecallFunctionDefinitionDocument): readonly OverviewBlock[] {
  if (answers) {
    return [
      paragraph('It answers with what its program makes of the view and that input:'),
      ...schemaBlocks(output.schema?.document, undescribedSentence('output', 'alone')),
    ];
  }
  const checked = output.schema === undefined ? [] : describedSchemaBlocks(output.schema.document);
  return [paragraph('It answers with the view itself, as it stands.'), ...checked];
}

function answersSection(document: RecallFunctionDefinitionDocument): OverviewSection {
  return sectionOf(
    'What it answers',
    paragraph('Each run takes:'),
    ...schemaBlocks(document.input.schema?.document, undescribedSentence('input', 'alone')),
    ...answerBlocks(document),
  );
}

function diagramOf(filters: readonly ViewFilter[], answers: boolean): Diagram {
  const view = filters.length;
  return {
    kind: 'diagram',
    nodes: [
      ...filters.map((filter) => ({ label: capitalized(plainTextOf(eventFilterPhrases(filter))) })),
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
    shownUnderSource(
      'program',
      'The program, its ',
      { code: 'fold' },
      ...(answers ? [' and its ', { code: 'answer' }] : []),
      ',',
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
