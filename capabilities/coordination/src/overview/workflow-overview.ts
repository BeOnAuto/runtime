import {
  bulletList,
  inputSection,
  numberedList,
  outputSection,
  paragraph,
  sectionOf,
  type OverviewContext,
  type OverviewParts,
  type OverviewSection,
} from '@on.auto/definitions';
import { field, type JsonObject } from '@on.auto/workflow-engine';

import type { ReadWorkflow } from '../document/workflow-document.ts';
import { outputShapeOf } from '../document/workflow-output.ts';
import { taskDiagramOf } from '../steps/task-diagram.ts';
import { calledSection } from './called-definitions.ts';
import { startsOf } from './trigger-words.ts';

function doneSection(document: JsonObject, entries: readonly string[]): OverviewSection {
  const { diagram, steps } = taskDiagramOf(field(document, 'do'), entries);
  return steps.length === 0
    ? sectionOf('What it does', paragraph('It has no steps, so a run ends as it starts.'))
    : sectionOf('What it does', diagram, paragraph('Its steps, numbered as in the diagram:'), numberedList(steps));
}

export function workflowOverview(
  { document }: ReadWorkflow,
  _name: string,
  { summary }: OverviewContext,
): OverviewParts {
  const { inputSchema, outputSchema, triggers = [] } = summary;
  const starts = startsOf(triggers);
  return {
    body: [],
    sections: [
      sectionOf('What starts it', bulletList(starts.map(({ words }) => words))),
      inputSection(inputSchema),
      outputSection(outputSchema, outputShapeOf(document)),
      doneSection(
        document,
        starts.map(({ label }) => label),
      ),
      calledSection(document),
    ],
    appendix: [],
  };
}
