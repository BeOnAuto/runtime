import { internalTermsIn } from '@on.auto/operations/testing';
import { writtenByAgents } from '@on.auto/playbooks/testing';
import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { changed, controls, experimentMilestones, experiments, oneOff, textOf } from './goal-examples.ts';
import { withinDetailBytes, type GoalIssue } from './goal-issues.ts';
import { goalsDocumentOf, type FurtherGoalsCheck, type GoalsChecking } from './goals-check.ts';
import { ContributesSchema, ContributionEntrySchema, type ContributionEntry } from './goals-document.ts';

const someWords: unknown = expect.any(String);

function issuesOf(source: string, checking?: GoalsChecking): readonly GoalIssue[] {
  const issues = Result.match(goalsDocumentOf(source, checking), { onSuccess: () => [], onFailure: (found) => found });
  for (const { detail } of issues) {
    expect(new TextEncoder().encode(detail).length).toBeLessThanOrEqual(256);
    expect(internalTermsIn(detail)).toEqual([]);
  }
  return issues;
}

const tooOften: GoalIssue = {
  pointer: '/0/notify/summary/cron',
  detail: 'The schedule comes round too often',
  fixed_by: 'agent',
};

describe('a goals document that holds', () => {
  it('decodes the goals as written, with their source, in their order', () => {
    const source = textOf([experiments, controls, oneOff]);

    expect(goalsDocumentOf(source)).toEqual(Result.succeed({ source, goals: [experiments, controls, oneOff] }));
  });

  it('takes a retired goal, no milestones written as an empty list, and a summary nothing is told in', () => {
    const goals = [
      { ...experiments, retired: true },
      { ...oneOff, milestones: [], notify: { ...oneOff.notify, passed: 'quiet' } },
    ];

    expect(goalsDocumentOf(textOf(goals))).toEqual(Result.succeed({ source: textOf(goals), goals }));
  });

  it('runs the further checks a caller hands it, only over goals that hold, and answers their issues', () => {
    const seen: unknown[] = [];
    const further: readonly FurtherGoalsCheck[] = [
      (goals: unknown) => {
        seen.push(goals);
        return [tooOften];
      },
    ];

    expect(issuesOf(textOf([experiments]), { further })).toEqual([tooOften]);
    expect(issuesOf(textOf([{ ...experiments, id: 'X' }]), { further })).toHaveLength(1);
    expect(seen).toEqual([[experiments]]);
  });
});

describe('the optional keys of a goal', () => {
  it('takes a goal with a short name and a goal that leaves notify out, keeping both as written', () => {
    const { notify: _told, ...untold } = controls;
    const goals = [{ ...experiments, name: 'Paying customers' }, untold];

    expect(goalsDocumentOf(textOf(goals))).toEqual(Result.succeed({ source: textOf(goals), goals }));
    expect(
      goalsDocumentOf(
        textOf([
          { ...experiments, name: 'Né' },
          { ...oneOff, name: 'a'.repeat(40) },
        ]),
      ),
    ).toEqual(
      Result.succeed({
        source: textOf([
          { ...experiments, name: 'Né' },
          { ...oneOff, name: 'a'.repeat(40) },
        ]),
        goals: [
          { ...experiments, name: 'Né' },
          { ...oneOff, name: 'a'.repeat(40) },
        ],
      }),
    );
  });
});

describe('the days a daily goal is judged on', () => {
  it('takes the days of the week a daily window is judged on, kept as written', () => {
    const weekdays = changed(controls, ['window', 'days'], ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']);
    const weekend = changed(controls, ['window', 'days'], ['saturday', 'sunday']);

    expect(goalsDocumentOf(textOf([weekdays]))).toEqual(
      Result.succeed({ source: textOf([weekdays]), goals: [weekdays] }),
    );
    expect(goalsDocumentOf(textOf([weekend]))).toEqual(Result.succeed({ source: textOf([weekend]), goals: [weekend] }));
  });
});

describe('the problems of the whole list', () => {
  it('refuse a goal id named twice, at the second', () => {
    expect(issuesOf(textOf([experiments, controls, { ...oneOff, id: 'paying-customers' }]))).toEqual([
      { pointer: '/2/id', detail: 'The goal paying-customers is named more than once', fixed_by: 'agent' },
    ]);
  });

  it('refuse more than eight goals, and goals that are not a list', () => {
    const many = Array.from({ length: 9 }, (_, index) => ({ ...oneOff, id: `goal-${String(index)}` }));

    expect(issuesOf(textOf(many))).toEqual([
      { pointer: '', detail: 'A playbook has at most 8 goals, and these are 9', fixed_by: 'agent' },
    ]);
    expect(issuesOf(textOf({ goals: [experiments] }))).toEqual([
      { pointer: '', detail: 'The goals are a list of goals, with no key around it', fixed_by: 'agent' },
    ]);
    expect(issuesOf('paying customers')).toHaveLength(1);
  });

  it('take eight goals and a text of exactly 16,384 bytes', () => {
    const eight = Array.from({ length: 8 }, (_, index) => ({ ...oneOff, id: `goal-${String(index)}` }));
    const text = textOf(eight);
    const padded = `${text}#${' '.repeat(16_384 - new TextEncoder().encode(text).length - 1)}`;

    expect(new TextEncoder().encode(padded).length).toBe(16_384);
    expect(issuesOf(padded)).toEqual([]);
  });

  it('take three and seven milestones, and statements of 12 and 200 characters', () => {
    const seven = [...experimentMilestones, ...['sixth', 'seventh'].map((id) => ({ id, label: 'More', by: 'auto' }))];
    const goals = [
      { ...experiments, milestones: experimentMilestones.slice(1, 4), statement: 'a'.repeat(12) },
      { ...experiments, id: 'more-customers', milestones: seven, statement: 'b'.repeat(200) },
    ];

    expect(issuesOf(textOf(goals))).toEqual([]);
  });

  it('refuse goals of more than 16,384 bytes before reading them', () => {
    expect(issuesOf(`# ${'é'.repeat(8192)}`)).toEqual([{ pointer: '', detail: someWords, fixed_by: 'agent' }]);
  });
});

const hashesBeforeWords = (text: string): number => text.match(/ #\S/gu)?.length ?? 0;

describe('a # written straight after a space and before a word', () => {
  it.each(Object.entries(writtenByAgents))(
    'is read as text in the goals of %s, in a flow map and out of one',
    (_run, written) => {
      const { source, goals } = Result.getOrThrow(goalsDocumentOf(written));

      expect(hashesBeforeWords(JSON.stringify(goals))).toBe(hashesBeforeWords(written));
      expect(source).toBe(written);
    },
  );

  it('reads a # already in quotes as text too, and keeps a comment a comment', () => {
    const quoted = textOf([changed(controls, ['success', 'label'], 'Failing controls in #compliance')]);
    const commented = `# The daily checks\n${textOf([controls]).replace('label: Failing controls', 'label: Failing controls # each day')}`;

    expect(goalsDocumentOf(quoted)).toEqual(
      Result.succeed({
        source: quoted,
        goals: [changed(controls, ['success', 'label'], 'Failing controls in #compliance')],
      }),
    );
    expect(goalsDocumentOf(commented)).toEqual(Result.succeed({ source: commented, goals: [controls] }));
  });

  it('reads the text by the plain rule when it already holds the private character the reading uses', () => {
    const unusual = changed(controls, ['statement'], 'Every control passes \u{E000}');
    const written = `${textOf([unusual])}# The daily checks #compliance`;

    expect(goalsDocumentOf(written)).toEqual(Result.succeed({ source: written, goals: [unusual] }));
  });
});

describe('the problems of the text', () => {
  it('refuse text that cannot be read, saying on which line', () => {
    expect(issuesOf('- id: [unclosed')).toMatchObject([{ pointer: '', fixed_by: 'agent' }]);
    expect(issuesOf('- id: first\n  id: second')[0]?.detail).toMatch(/^Line 2: /u);
  });

  it('refuse aliases, anchors and tags', () => {
    expect(issuesOf(`- &first ${JSON.stringify(oneOff)}\n- *first`).map(({ detail }) => detail)).toEqual([
      'An anchor (&first) is not allowed',
      'An alias (*first) is not allowed; write the value out',
    ]);
    expect(issuesOf('- !!map {}')).toEqual([
      { pointer: '', detail: 'A tag is not allowed; write the value plainly', fixed_by: 'agent' },
    ]);
  });

  it('keep every detail within its bytes, cut at a whole character', () => {
    const cut = withinDetailBytes(`${'é'.repeat(200)} `);

    expect(new TextEncoder().encode(cut).length).toBeLessThanOrEqual(256);
    expect(cut.endsWith('é…')).toBe(true);
    expect(withinDetailBytes('short')).toBe('short');
  });
});

const measuring: ContributionEntry = {
  goal: 'paying-customers',
  purpose: 'Measures what each experiment brought in.',
  each: '/results',
  per_id: '/issue_id',
  title: '/title',
  link: '/issue_url',
  when: '${ $data.status == "measured" }',
  marks: 'measured',
  measures: '/customers_attributed',
  final: '/window_closed',
  as_of: '/measured_through',
  says: '/summary',
};

const decodedContributes = Schema.decodeUnknownResult(ContributesSchema);

describe('the decoded entries of what a workflow contributes', () => {
  it('hold every key an entry may carry, and final as a pointer or the literal true', () => {
    const checking = { goal: 'controls-hold', purpose: 'Checks the controls.', final: true };

    expect(decodedContributes([measuring, checking])).toEqual(Result.succeed([measuring, checking]));
    expect(Schema.decodeUnknownResult(ContributionEntrySchema)(checking)).toEqual(Result.succeed(checking));
  });

  it('name the keys of a contribution in their order, with no by_hand, and take eight entries', () => {
    expect(Object.keys(ContributionEntrySchema.fields)).toEqual([
      'goal',
      'purpose',
      'each',
      'per_id',
      'title',
      'link',
      'when',
      'marks',
      'measures',
      'final',
      'as_of',
      'says',
    ]);
    const eight = Array.from({ length: 8 }, () => measuring);
    expect(decodedContributes(eight)).toEqual(Result.succeed(eight));
  });

  it('refuse an entry without its purpose, a final of false, and more than eight entries', () => {
    expect(Result.isFailure(decodedContributes([{ goal: 'paying-customers' }]))).toBe(true);
    expect(Result.isFailure(decodedContributes([{ ...measuring, final: false }]))).toBe(true);
    expect(Result.isFailure(decodedContributes(Array.from({ length: 9 }, () => measuring)))).toBe(true);
  });
});
