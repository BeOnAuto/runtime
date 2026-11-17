import { describe, expect, it } from 'vitest';

import { mostGuideBytes } from '../../bounds/served-bounds.ts';
import { byteLengthOf } from '../../testing/guide-shelves.ts';
import {
  gapRowsOf,
  goalsGuideFile,
  headingsOf,
  markers,
  sectionOf,
  withMessages,
  withoutMessages,
} from './goals-guide-reading.ts';

const renditions = [
  ['with messages', withMessages],
  ['without messages', withoutMessages],
] as const;

function markerFaults(text: string): readonly string[] {
  const lines = text.split('\n');
  const fenced = lines.map((_, at) => lines.slice(0, at).filter((line) => line.startsWith('```')).length % 2 === 1);
  const marked = lines.flatMap((line, at) => (line.startsWith('<!--') ? [at] : []));
  const known: readonly string[] = Object.values(markers);
  const unknown = marked.filter((at) => !known.includes(String(lines[at])));
  const crowded = marked.filter((at) => fenced[at] !== true && (lines[at - 1] !== '' || lines[at + 1] !== ''));
  const order = marked.map((at) => (lines[at] === markers.end ? 'end' : 'open')).join(' ');
  return [
    ...[...unknown, ...crowded].map((at) => `line ${at + 1}: ${String(lines[at])}`),
    ...(/^(open end ?)*$/u.test(order) ? [] : [`blocks open and close out of turn: ${order}`]),
  ];
}

describe('the goals guide file', () => {
  it('marks each block on a line of its own between blank lines outside a code fence, as the formatter keeps it, and closes every block it opens', () => {
    expect(markerFaults(goalsGuideFile)).toEqual([]);
  });
});

describe('the goals guide file', () => {
  it('gives both renditions single blank lines and keeps each within the bytes of a guide', () => {
    for (const [, guide] of renditions) {
      expect(guide).not.toContain('<!--');
      expect(guide).not.toMatch(/\n\n\n/u);
      expect(byteLengthOf(guide)).toBeLessThanOrEqual(mostGuideBytes);
    }
  });
});

const headingsWithout = [
  '## Before you build anything, learn the goals with the person',
  '## Never invent a goal',
  '## After the create, show the saved goals and record the yes',
  '## The goals argument',
  '### A goal judged thing by thing, with milestones',
  '### A goal judged on a calendar',
  '### Choosing settles',
  '## What a workflow contributes',
  '### final and as_of',
  '### The contributions for the experiments',
  '### The contribution for the daily checks',
  '## Older playbooks',
  '## Which runs count',
  '## Gaps, and who fixes each',
];

describe('the goals guide', () => {
  it('goes from the conversation to the format, in the order an agent needs it, with the notification function only where messages are on', () => {
    expect(headingsOf(withoutMessages)).toEqual(headingsWithout);
    expect(headingsOf(withMessages)).toEqual(headingsWithout.toSpliced(11, 0, '## The notification function'));
  });
});

describe('the goals guide where messages are on', () => {
  it('gives the notify keys of a goal', () => {
    expect(withMessages).toMatch(/\| `notify.through` +\|/u);
    expect(withMessages).toContain('  notify:\n    passed: now\n');
    expect(withMessages).toContain('  notify:\n    passed: quiet\n');
  });
});

describe('the goals guide where messages are on', () => {
  it('shows a notification function that expires and reads its optional fields only inside a condition', () => {
    const notifying = sectionOf(withMessages, '## The notification function');

    expect(notifying).toContain('expires: PT4H');
    expect(notifying).toContain('{%- if input.detail %}\n\n{{ input.detail }}\n{%- endif %}');
    expect(
      ['`change`', '`headline`', '`detail`', '`link`', '`owner`', '`goal`'].every((field) =>
        notifying.includes(`| ${field}`),
      ),
    ).toBe(true);
  });
});

describe('the goals guide where messages are on', () => {
  it('names who fixes each gap', () => {
    const rows = gapRowsOf(sectionOf(withMessages, '## Gaps, and who fixes each'));

    expect(rows).toEqual([
      ['no_goal', 'Person'],
      ['no_milestones', 'Person'],
      ['connection_missing', 'Person'],
      ['measure_unreported', 'Agent'],
      ['measure_paused', 'Agent'],
      ['measure_never_final', 'Agent'],
      ['milestone_unmarked', 'Agent'],
      ['window_never_starts', 'Agent'],
      ['workflow_without_contribution', 'Agent'],
      ['contribution_orphaned', 'Agent'],
      ['notice_function_missing', 'Agent'],
      ['notice_not_started', 'Agent'],
      ['notice_undelivered', 'Agent'],
      ['observation_refused', 'Agent'],
    ]);
  });
});

describe('the goals guide where messages are off', () => {
  it('leaves notify, summaries and the notification function out', () => {
    expect(withoutMessages).not.toMatch(/notify:|summary:|\| `notify\.|## The notification function/u);
  });
});

describe('the goals guide where messages are off', () => {
  it('names who fixes each gap, with no gap of a message', () => {
    const rows = gapRowsOf(sectionOf(withoutMessages, '## Gaps, and who fixes each'));

    expect(rows.map(([kind]) => kind)).toEqual([
      'no_goal',
      'no_milestones',
      'connection_missing',
      'measure_unreported',
      'measure_paused',
      'measure_never_final',
      'milestone_unmarked',
      'window_never_starts',
      'workflow_without_contribution',
      'contribution_orphaned',
      'observation_refused',
    ]);
  });
});
