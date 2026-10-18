import { markdownOf, numberedList, sectionOf } from '@on.auto/definitions';
import { field } from '@on.auto/workflow-engine';

import { taskDiagramOf } from '../steps/task-diagram.ts';
import { workflow } from './workflows.ts';

export interface DoneSteps {
  readonly diagram: readonly string[];
  readonly steps: readonly string[];
}

export interface StepNumbers {
  readonly drawn: readonly number[];
  readonly listed: readonly number[];
}

const labelledStep = /^\s*(?:n\d+\W+|subgraph g\d+\[")(?<step>\d+)\. /u;

export function doneIn(tasks: string, entries: readonly string[] = ['By a call']): DoneSteps {
  const { diagram, steps } = taskDiagramOf(field(workflow(`do:\n${tasks}`), 'do'), entries);
  const parts = markdownOf({
    title: 'flow',
    opening: [],
    body: [],
    sections: [sectionOf('What it does', diagram, numberedList(steps))],
    appendix: [],
  }).split('\n\n');
  return { diagram: String(parts[3]).split('\n').slice(2, -1), steps: String(parts[4]).trimEnd().split('\n') };
}

function stepOf(line: string): readonly number[] {
  const step = labelledStep.exec(line)?.groups?.['step'];
  return step === undefined ? [] : [Number(step)];
}

export function stepNumbersOf({ diagram, steps }: DoneSteps): StepNumbers {
  return {
    drawn: diagram.flatMap((line) => stepOf(line)).toSorted((left, right) => left - right),
    listed: steps.map((item) => Number(item.slice(0, item.indexOf('.')))),
  };
}
