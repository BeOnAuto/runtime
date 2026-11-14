import { describe, expect, it } from 'vitest';

import { mostGuideBytes } from '../../bounds/served-bounds.ts';
import { byteLengthOf } from '../../testing/guide-shelves.ts';
import { goalsGuideFile, markers, sectionOf, withMessages, withoutMessages } from './goals-guide-reading.ts';

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

describe('the goals guide', () => {
  it.each(renditions)(
    'has the agent learn the goal, its name and how they will know it worked, say it back and wait for a yes before the create (%s)',
    (_, guide) => {
      const learning = sectionOf(guide, '## Before you build anything, learn the goals with the person');

      expect(learning).toContain(
        'Do not create the playbook, a function or a workflow until you have every answer below and the person has said yes to what you will save.',
      );
      expect(learning).toContain('Then say it back in their words, in one sentence, and ask whether that is right.');
      expect(learning).toContain(
        '2. **What to call it.** Suggest a short name for the goal, two to four words from their own, such as "Catering replies" or "Daily controls", and ask whether it fits. That is the goal\'s `name`, the title the person sees it under. Ask it even when the person has said everything else.',
      );
      expect(learning).toContain('When they have no number in mind, suggest one that fits what they said');
      expect(learning).toContain('A person who says little at first gets one question at a time.');
      expect(learning).toContain(
        'A person who says much of it at once is not asked it again: say back what you heard, in their words, ask only what is still missing, and wait for their yes.',
      );
      expect(learning).toContain(
        'Create the playbook only after their yes to that message, and never earlier just to reach another tool.',
      );
      expect(learning).toContain(
        "That yes allows the create and nothing else; the Studio link and connections aren't needed before it.",
      );
      expect(learning).toContain("A statement that only repeats the playbook's name or description is refused.");
      expect(learning).toContain("That word is the goal's `per`.");
      expect(learning).toContain('three to seven of them');
    },
  );
});

describe('the goals guide', () => {
  it.each(renditions)(
    'has the agent show the saved goals and the link, wait for a yes, and record it with agree_playbook_goals at the version the person saw before building anything (%s)',
    (_, guide) => {
      const learning = sectionOf(guide, '## Before you build anything, learn the goals with the person');
      const agreeing = sectionOf(guide, '## After the create, show the saved goals and record the yes');

      expect(learning).toContain(
        'Once the playbook is created, stop: say back the goals as saved, give the person the `studio` link its answer holds, ask whether the saved goals are what they want, and wait for their yes. Then record that yes with agree_playbook_goals, giving the `version` of the goals they saw, before you make any function or workflow.',
      );
      expect(learning).toContain(
        'After that yes, put any change to the saved goals to the person first, save it only after their yes, and record that yes with a new call of agree_playbook_goals and the new version. Never change a goal to suit how you built something.',
      );
      expect(agreeing).toContain('`studio`, a link that opens the lead goal in Studio');
      expect(agreeing).toContain('Change the goals with update_playbook until they say yes.');
      expect(agreeing).toContain(
        'When you ask through a question tool, put the link in the question itself or in a message just before it: the person needs it to see the saved goals.',
      );
      expect(agreeing).toContain(
        'The yes before the create allows the create and nothing more; the yes you record is the one to the goals as saved.',
      );
      expect(agreeing).toContain(
        'Once they say yes, call agree_playbook_goals with the `version` they saw, before you make anything else.',
      );
      expect(agreeing).toContain('Build nothing before that call: no function and no workflow.');
      expect(agreeing).toContain('A save that changes a goal, its name included, drops the yes to that goal.');
      expect(agreeing).toContain(
        'So after the yes, put a change to the person first, save it as they agreed it, and call agree_playbook_goals again with the new version before you build on it.',
      );
      expect(agreeing).toContain(
        'When the call answers that the goals changed since the version you gave, show the person the saved goals again and ask before you record a yes.',
      );
      expect(agreeing).toContain('A gap is not a refusal.');
    },
  );
});

describe('the goals guide', () => {
  it.each(renditions)(
    'forbids a goal the person did not state and a yes they did not give, and takes a refusal that asks the person as their question (%s)',
    (_, guide) => {
      const inventing = sectionOf(guide, '## Never invent a goal');

      expect(inventing).toContain('Save only what the person said or agreed to.');
      expect(inventing).toContain('Do not fill in a statement, a name, a target');
      expect(inventing).toContain('A measure, a word or a time you suggested counts only once they say yes to it.');
      expect(inventing).toContain('each missing thing its own question');
      expect(inventing).toContain('When the runtime refuses or answers with words that begin "Ask the person:"');
      expect(inventing).toContain('It is not a puzzle to solve alone');
      expect(inventing).toContain(
        '"Ask the person: What should this playbook achieve for you, and how will you know it worked?"',
      );
      expect(inventing).toContain(
        'Never record a yes the person did not give. agree_playbook_goals is their answer in the conversation, not a step you take to get past a refusal or a gap.',
      );
    },
  );
});

describe('the goals guide', () => {
  it.each(renditions)(
    'gives the limits of the goals and of what a workflow contributes, how to choose settles, and what final and as_of mean (%s)',
    (_, guide) => {
      expect(guide).toContain('- At most 8 goals and 16,384 bytes.');
      expect(guide).toContain('Send the whole list every time.');
      expect(guide).toContain('Stop it with `retired: true`');
      expect(guide).toContain('A different shape is a new goal with a new id.');
      expect(guide).toMatch(
        /\| `name` +\| No; always ask for one +\| The goal's short name in the person's words, two to four words, 2 to 40 characters +\|/u,
      );
      expect(guide).toContain('Make it from the name, such as `catering-replies`');
      expect(guide).toContain('  name: Paying customers\n');
      expect(guide).toContain('  name: Daily controls\n');
      expect(guide).toContain('A calendar window is not allowed together with `per`.');
      expect(guide).toContain(
        "A calendar window's time zone cannot change once the goal is saved, so a different one needs a new goal id",
      );
      expect(guide).toContain('from `PT1M` to `P90D`');
      expect(guide).toContain(
        'Its verdict can come that much later, so put any grace you choose to the person with the window, as you would a target.',
      );
      expect(guide).toContain(
        'A running total, or a "never above", is `on_crossing`: it passes or fails as soon as a measurement crosses the target. A ratio, an average, or "by the end of the week" is `at_close`',
      );
      expect(guide).toContain('- At most 8 entries.');
      expect(guide).toContain('`each` takes at most a hundred items');
      expect(guide).toContain('`final` says the measurement will not change any more for its window.');
      expect(guide).toContain(
        "A final measurement that arrives later still decides it, but only when its `as_of` lies at or before the window's close.",
      );
      expect(guide).toContain('so a total measured through the close belongs to the window it closes');
      expect(guide).toContain(
        'choose a schedule from how often the source changes and how soon the person needs to know.',
      );
    },
  );
});

describe('the goals guide', () => {
  it.each(renditions)(
    'brings an older playbook over when a workflow save is refused, with update_playbook and the yes recorded (%s)',
    (_, guide) => {
      const older = sectionOf(guide, '## Older playbooks');

      expect(older).toContain('create_definition or update_definition refuses it');
      expect(older).toContain('1. Learn the goals with the person, as above.');
      expect(older).toContain('2. Send the goals with update_playbook');
      expect(older).toContain('tell the person in their words what you saved');
      expect(older).toContain(
        'Its answer carries no `studio` link. Record their yes with agree_playbook_goals and the version saved.',
      );
      expect(older).toContain('3. Save the workflow again, with its `contributes`.');
    },
  );
});

describe('the goals guide', () => {
  it.each(renditions)(
    'says a run a signed-in person began counts for nothing, one started with an API key counts, and how a person marks their own milestone (%s)',
    (_, guide) => {
      const counting = sectionOf(guide, '## Which runs count');

      expect(counting).toContain('only when its chain began with a schedule or with a call made with an API key');
      expect(counting).toContain('A run that a signed-in person began counts for nothing.');
      expect(counting).toContain("so never test a goal's workflow with an API key.");
      expect(counting).toContain('You cannot test a goal by running its workflow');
      expect(counting).toContain(
        "A person's own milestone is marked when they answer a request inside a run that a schedule or an API key began.",
      );
    },
  );
});
