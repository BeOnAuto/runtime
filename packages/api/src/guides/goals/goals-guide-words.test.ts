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
    'has the agent learn the goal, its name and how they will know it worked, and wait for a yes to one proposal before the create (%s)',
    (_, guide) => {
      const learning = sectionOf(guide, '## Before you build anything, learn the goals with the person');

      expect(learning).toContain(
        'Do not create the playbook, a function or a workflow until you have every answer below and the person has said yes to what you will save.',
      );
      expect(learning).toContain("Their words for it, in one sentence, are the goal's statement.");
      expect(learning).toContain(
        '2. **What to call it.** A short name for the goal, two to four words from their own, such as "Catering replies" or "Daily controls". That is the goal\'s `name`, the title the person sees it under. Suggest one in the proposal, even when the person has said everything else.',
      );
      expect(learning).toContain(
        'When they have no number in mind, the proposal suggests one that fits what they said.',
      );
      expect(learning).toContain(
        'Ask first, then propose once. Put everything that is still missing to the person in one round of questions, and do not say a goal or a measure back to them while you ask. A person who has already said some of it is not asked it again.',
      );
      expect(learning).toContain(
        "Create the playbook only after their yes to the proposal, and never earlier just to reach another tool; the Studio link isn't needed before it.",
      );
      expect(learning).toContain(
        'Say which name or number is your suggestion: their yes to the proposal takes it. Then ask: Did I get all that right? Yes, or tell me what to change. Where your client has a question tool, ask that question through it right after the message, with nothing of the proposal in the question; otherwise end the message with it.',
      );
      expect(learning).toContain("A statement that only repeats the playbook's name or description is refused.");
      expect(learning).toContain("That word is the goal's `per`.");
      expect(learning).toContain('three to seven of them');
    },
  );
});

describe('the goals guide', () => {
  it.each(renditions)(
    'has the agent give the link after the create and record the yes to the proposal with agree_playbook_goals at the version saved, asking again only when something changed, before building anything (%s)',
    (_, guide) => {
      const learning = sectionOf(guide, '## Before you build anything, learn the goals with the person');
      const agreeing = sectionOf(guide, '## After the create, show the saved goals and record the yes');

      expect(learning).toContain(
        'Then record that yes as [After the create](#after-the-create-show-the-saved-goals-and-record-the-yes) says. Never change a goal to suit how you built something.',
      );
      expect(agreeing).toContain('`studio`, a link that opens the lead goal in Studio');
      expect(agreeing).toContain(
        'When the saved goals are the ones they said yes to, unchanged, record that yes with agree_playbook_goals and the `version` saved, without asking again.',
      );
      expect(agreeing).toContain(
        'When anything changed, show them what changed and ask again; through a question tool, put the link in the question itself or in a message just before it.',
      );
      expect(agreeing).toContain('Change the goals with update_playbook until they say yes.');
      expect(agreeing).not.toContain('The yes before the create allows the create');
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
        /\| `name` +\| No; suggest one in the proposal +\| The goal's short name in the person's words, two to four words, 2 to 40 characters +\|/u,
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
      expect(older).toContain(
        "2. Send the goals with update_playbook once they say yes to the proposal, and record that yes with agree_playbook_goals and the version saved, as above. update_playbook's answer carries no `studio` link.",
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
