import { describe, expect, it } from 'vitest';

import { gapRowsOf, headingsOf, sectionOf, withMessages, withoutMessages } from './goals-guide-reading.ts';

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

const messagesOff =
  "Auto does not send messages about goals here yet. Do not ask the person whether, when or where they want to be told about results, and do not offer it. Leave `notify` out of the goals and make no notification function. They see their results in Studio. If they ask to be told, or say when they do or don't want to hear about it, first say that Auto doesn't send messages about goals yet and that their results are in Studio. Only then may you offer to build the post into the playbook as ordinary work, and build it only after they say yes to that. Ask which time zone they mean when a day or a week matters.";

describe('the goals guide', () => {
  it('goes from the conversation to the format, in the order an agent needs it, with the notification function only where messages are on', () => {
    expect(headingsOf(withoutMessages)).toEqual(headingsWithout);
    expect(headingsOf(withMessages)).toEqual(headingsWithout.toSpliced(11, 0, '## The notification function'));
  });
});

describe('the goals guide where messages are on', () => {
  it('has the agent learn what to be told and where, and say it back before the create', () => {
    const learning = sectionOf(withMessages, '## Before you build anything, learn the goals with the person');

    expect(learning).toContain(
      'Before the create, say all of it back in one message: the goal and its name, the number and target that judge it with the words for a pass and a fail, and what you will tell them, when and where.',
    );
    expect(learning).toContain('whether they want to be told immediately, in a summary on a schedule, or not at all');
    expect(
      ['when it passes;', 'when it fails;', 'when it becomes overdue:'].map((words) => learning.includes(words)),
    ).toEqual([true, true, true]);
    expect(learning).toContain('If they also want a summary, it lists every result, whichever they choose.');
    expect(learning).toContain('Then ask where to tell them (a channel or an address)');
    expect(learning).toContain('Ask which time zone they mean when a time or a day matters');
    expect(learning).toContain(
      'Two things are still missing, so ask them: which channel, and which time zone their days and their nine in the morning are in.',
    );
    expect(learning).toContain(
      'That is passed `quiet`, failed `now`, overdue `now`, through the function that posts in that channel, and a summary every Friday at 09:00.',
    );
    expect(learning).not.toContain(messagesOff);
  });
});

describe('the goals guide where messages are on', () => {
  it('gives the notify keys of a goal and the summary limit', () => {
    expect(withMessages).toMatch(/\| `notify.through` +\| When any of them is `now` +\|/u);
    expect(withMessages).toContain('A summary may not come more often than once an hour.');
    expect(withMessages).toContain(
      "give it as `time_zone` in both the window and the summary. A calendar window's time zone cannot change once the goal is saved, so a different one needs a new goal id; the summary's can change at any time.",
    );
    expect(withMessages).toContain('  notify:\n    passed: now\n');
    expect(withMessages).toContain('  notify:\n    passed: quiet\n');
  });
});

describe('the goals guide where messages are on', () => {
  it('has one notification function send both a message and a summary, with at least an hour before it expires, and names a notice once as the message the person reads', () => {
    const notifying = sectionOf(withMessages, '## The notification function');

    expect(notifying).toContain(
      'The runtime calls such a message a notice, as in the gap kinds that begin `notice_`; say "message" to the person.',
    );
    expect(notifying).toContain('One function can send both a message and a summary.');
    expect(notifying).toContain('a playbook sends at most two hundred of them in a UTC day.');
    expect(notifying).toContain('Give it at least an hour before it expires');
    expect(notifying).toContain('expires: PT4H');
    expect(notifying).toContain('reads `detail` and `link` only inside `{% if %}`, since either can be absent');
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
  it('has the agent ask nothing about being told, leave notify out and make no function to tell the person, and says so in one paragraph alone', () => {
    const learning = sectionOf(withoutMessages, '## Before you build anything, learn the goals with the person');
    const telling = withoutMessages
      .split('\n')
      .filter((line) => /\bnotify\b|\btold\b|\btell them\b|notification|\bnotice/iu.test(line));

    expect(learning).toContain(messagesOff);
    expect(telling).toEqual([
      'Auto does not send messages about goals here yet. Whenever the person asks to be told about results, say that first, and that their results are in Studio, before you ask or offer anything about telling them. Say it even when a post in their channel is part of the work they ask for.',
      messagesOff,
      "The same holds when you plan the work after the yes. If the person asked to be told about results, your first words about it are that Auto doesn't send messages about goals yet and that their results are in Studio. Only then ask whether they want a post built into the playbook, and where. Never ask it if they didn't ask to be told.",
    ]);
    expect(learning).toContain(
      'Before the create, say all of it back in one message: the goal and its name, and the number and target that judge it with the words for a pass and a fail.',
    );
    expect(learning).toContain(
      'Two things are still missing, so ask them: which time zone their days are in, and whether "Daily controls" is the name they want for it.',
    );
    expect(learning).toContain(
      "Say first that Auto doesn't send messages about goals yet and that the results will be in Studio. Then learn the goal behind the wish",
    );
    expect(learning).toContain('The statement says what should be achieved, never how they hear about it.');
    expect(withoutMessages).toContain("give it as the window's `time_zone`.");
    expect(withoutMessages).not.toContain('summary:');
    expect(withoutMessages).not.toMatch(/\bmessage they\b|send the person a message|no message follows/u);
  });
});

describe('the goals guide where messages are off', () => {
  it('names who fixes each gap, with no gap of a message', () => {
    const rows = gapRowsOf(sectionOf(withoutMessages, '## Gaps, and who fixes each'));

    expect(rows.map(([kind]) => kind)).toEqual([
      'no_goal',
      'no_milestones',
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
