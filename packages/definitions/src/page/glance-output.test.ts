import { describe, expect, it } from 'vitest';

import type { ParsedTemplate, VariableSegment } from '../template/template-parsing.ts';
import type { ParsedGlance } from './page-document.ts';
import { glanceNamesTheOutput } from './page-rendering.ts';

function reading(...path: readonly VariableSegment[]): ParsedGlance {
  const template: ParsedTemplate = {
    templates: () => [],
    variables: [{ path, line: 1 }],
    issues: [],
    text: '',
    firstLine: 1,
  };
  return { kind: 'text', template, whole: false };
}

const aValue: ParsedGlance = { kind: 'value', value: 3 };

describe('a glance, as the read of the latest run’s output asks it', () => {
  it('names the output where any of its templates reads it, in a mapping or a list at any depth', () => {
    expect([
      glanceNamesTheOutput(reading('output', 'greeting')),
      glanceNamesTheOutput({
        kind: 'mapping',
        entries: [
          ['n', aValue],
          ['said', reading('output')],
        ],
      }),
      glanceNamesTheOutput({ kind: 'list', items: [aValue, { kind: 'list', items: [reading('output', 0)] }] }),
    ]).toEqual([true, true, true]);
  });

  it('names none where its templates read only the views, the run and the moment, or it holds values alone', () => {
    expect([
      glanceNamesTheOutput(reading('run', 'status')),
      glanceNamesTheOutput(aValue),
      glanceNamesTheOutput({
        kind: 'mapping',
        entries: [
          ['n', aValue],
          ['days', reading('views', 'by_day')],
        ],
      }),
      glanceNamesTheOutput({ kind: 'list', items: [reading('today')] }),
    ]).toEqual([false, false, false, false]);
  });
});
