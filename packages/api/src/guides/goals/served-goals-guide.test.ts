import { readFileSync } from 'node:fs';

import { internalTermsIn } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import {
  mostGuideBytes,
  mostGuidesBeyondTheRecipes,
  mostRecipeBytes,
  mostRecipeBytesWhere,
} from '../../bounds/served-bounds.ts';
import {
  byteLengthOf,
  recipeTextsOf,
  servedWithEverything,
  servedWithEverythingAndGoals,
  servedWithEverythingAndGoalsUntold,
} from '../../testing/guide-shelves.ts';
import { goalsInsertedAfter } from '../built-recipes.ts';
import { goalsGuideIn } from '../goals-guide-renditions.ts';
import { guideShelfOf, type DefinitionType, type Guide } from '../guide-shelf.ts';

const goalsPage = readFileSync(new URL('goals.md', import.meta.url), 'utf8');

const goalsSection = [
  '',
  '## Its goals',
  '',
  "A goal is what the playbook is for, in the person's own words: what it should achieve for them, how they will know it worked, and what they want to be told about, and where. A playbook here cannot be made without its goals: create_playbook refuses one that has none, and a workflow saved in a playbook that has none is refused too.",
  '',
  "So your first step, before you make anything, is to ask the person, through your client's question tool where it has one: What should this playbook achieve for you, and how will you know it worked? Say their answer back in their words, learn the rest as the goals guide says, and send it as the goals argument of create_playbook, or of update_playbook for a playbook that has no goals yet. Then show them the saved goals at the `studio` link the answer holds, and wait for their yes before you make anything else. Every workflow you save then says what it does for a goal.",
].join('\n');

const goalsInWhereToGo =
  "\n- What a playbook's goals are, and how to learn them with the person before you make anything: the goals guide.";

const whereToGoBeginsWith = '## Where to go\n\n- What the words of a playbook mean: the guide terminology.';

const goalsInFirstPlaybook =
  ' Here a playbook is made only with its goals, so before you create it, ask the person: What should this playbook achieve for you, and how will you know it worked? Learn too what they want to be told when it passes, fails or becomes overdue, and where. Say the goals back in their words, write them as the goals guide says, and send them as the goals argument of create_playbook; a playbook they name that has no goals yet takes them through update_playbook. Their yes to what you said back allows the create and nothing else: then show the person the saved goals at the `studio` link it answers, change them with update_playbook until they say yes to them as saved, and make nothing else before that yes. Every workflow you save then says, in its `contributes`, what it does for a goal.';

const toldInFirstPlaybook = ' Learn too what they want to be told when it passes, fails or becomes overdue, and where.';

const createStep =
  "4. Create the playbook with create_playbook, with the person's words on what it is for, or use the playbook they name when list_playbooks shows it.";

const goalsTerms = [
  '',
  'Goals:',
  '',
  "- Goal: What a playbook is for, in the person's own words, with how they will know it worked and what they want to be told about, and where. A playbook owns its goals, and the first one leads.",
  "- Milestone: One of the three to seven points of a goal that matter, where the person acts or where Auto collects something. Each is one segment of the goal's ring, and a workflow marks one through its contribution.",
  '- Measure: The one number a goal is judged by, with its label and its target.',
  "- Contribution: What a workflow does for a goal, written under contributes in its document: its purpose in the person's words, the milestone it marks and the measure it reports.",
  '- Verdict: Where one judging of a goal stands: open, passed or failed. The goal gives its own words for passed and failed.',
  '- Message: What Auto sends the person when a judging of a goal passes, fails or becomes overdue, through the notification function the goal names. The runtime calls it a notice, as in the gap kinds that begin notice_.',
  "- Summary: What Auto sends the person on the goal's own schedule, summing up its judgings.",
].join('\n');

function namesOf(guides: readonly Pick<Guide, 'name'>[]): readonly string[] {
  return guides.map(({ name }) => name);
}

function textOf(guide: Guide | undefined): string {
  return String(guide?.text);
}

describe('the guides of a server that keeps goals', () => {
  it('carry the goals guide after the terminology, the whole text the package ships, and offer it by name beside every guide a server without goals carries', () => {
    const goals = servedWithEverythingAndGoals.named('goals');

    expect(namesOf(servedWithEverythingAndGoals.everyGuide)).toEqual(
      namesOf(servedWithEverything.everyGuide).toSpliced(2, 0, 'goals'),
    );
    expect(goals).toEqual({
      name: 'goals',
      title: 'Goals',
      description:
        'What a playbook should achieve for the person, how they will know it worked, and what they want to be told about, and where.',
      text: goalsGuideIn(goalsPage, { messages: true }),
    });
    expect(internalTermsIn(goalsPage)).toEqual([]);
  });

  it('give the start guide its goals section after what a playbook is made of and the goals guide under where to go, and change nothing else in it', () => {
    const withGoals = textOf(servedWithEverythingAndGoals.named('start'));
    const without = textOf(servedWithEverything.named('start'));

    expect(withGoals.replace(`\n${goalsSection}`, '').replace(goalsInWhereToGo, '')).toBe(without);
    expect(withGoals).toContain(`${whereToGoBeginsWith}${goalsInWhereToGo}\n- To build a playbook from nothing`);
    expect(withGoals).toContain(`results, run by run and over time.\n${goalsSection}\n\n## What a workflow owns`);
    expect(without).toContain(whereToGoBeginsWith);
    expect([byteLengthOf(withGoals), byteLengthOf(without)]).toEqual([8703, 7670]);
    expect(internalTermsIn(withGoals)).toEqual([]);
  });
});

describe('the terminology and recipes of a server that keeps goals', () => {
  it('give the terminology its goal words at the end, and change nothing else in it', () => {
    const withGoals = textOf(servedWithEverythingAndGoals.named('terminology'));
    const without = textOf(servedWithEverything.named('terminology'));

    expect(withGoals).toBe(`${without.trimEnd()}\n${goalsTerms}\n`);
    expect(internalTermsIn(goalsTerms)).toEqual([]);
  });

  it('insert the goals step in the first-playbook recipe at the end of the step that creates the playbook, within the bytes of a recipe where goals are kept, a KiB beyond those of any other server', () => {
    const withGoals = String(recipeTextsOf(servedWithEverythingAndGoals)['first-playbook']);
    const without = String(recipeTextsOf(servedWithEverything)['first-playbook']);

    expect(withGoals.replace(goalsInFirstPlaybook, '')).toBe(without);
    expect(createStep.endsWith(goalsInsertedAfter)).toBe(true);
    expect(without).toContain(`\n${createStep}\n5. Write each function`);
    expect(withGoals).toContain(`\n${createStep}${goalsInFirstPlaybook}\n5. Write each function`);
    expect([byteLengthOf(without), byteLengthOf(withGoals)]).toEqual([7504, 8290]);
    expect(byteLengthOf(withGoals)).toBeGreaterThan(mostRecipeBytes);
    expect(byteLengthOf(withGoals)).toBeLessThanOrEqual(mostRecipeBytesWhere(true));
    expect(internalTermsIn(goalsInFirstPlaybook)).toEqual([]);
  });

  it('leave every other recipe as a server without goals has it', () => {
    const withGoals = recipeTextsOf(servedWithEverythingAndGoals);
    const { 'first-playbook': _first, ...without } = recipeTextsOf(servedWithEverything);

    expect(Object.fromEntries(Object.keys(without).map((name) => [name, withGoals[name]]))).toEqual(without);
  });
});

function guidesNumbering(count: number): readonly Guide[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `guide-${index}`,
    title: `Guide ${index}`,
    description: `The guide ${index}.`,
    text: '# A guide\n',
  }));
}

describe('the guide shelf of a server, against its bound', () => {
  const types: readonly DefinitionType[] = Array.from({ length: 4 }, (_, index) => ({
    type: `kind-${index}`,
    noun: 'kind',
    guide: `guide-${index}`,
  }));

  it('hold one guide more where goals are kept, and refuse one beyond that', () => {
    expect([mostGuidesBeyondTheRecipes(4), mostGuidesBeyondTheRecipes(4, true)]).toEqual([12, 13]);
    expect(() => guideShelfOf(guidesNumbering(13), [], types, { goals: true })).not.toThrow();
    expect(() => guideShelfOf(guidesNumbering(13), [], types)).toThrow(
      'The guides of the server: 13 guides, more than the 12 allowed',
    );
    expect(() => guideShelfOf(guidesNumbering(14), [], types, { goals: true })).toThrow(
      'The guides of the server: 14 guides, more than the 13 allowed',
    );
  });
});

const toldWords = /\bnotify\b|\btold\b|notification function/iu;

function linesInsideWithoutBlocks(text: string): ReadonlySet<string> {
  const inside = new Set<string>();
  let open = false;
  for (const line of text.split('\n')) {
    if (line === '<!-- end -->') {
      open = false;
    } else if (open) {
      inside.add(line);
    } else {
      open = line === '<!-- without messages -->';
    }
  }
  return inside;
}

describe('the goals guide where messages are off', () => {
  const untold = String(servedWithEverythingAndGoalsUntold.named('goals')?.text);
  const told = String(servedWithEverythingAndGoals.named('goals')?.text);

  it('serves the rendition without messages, under a description that does not offer to tell the person', () => {
    expect(servedWithEverythingAndGoalsUntold.named('goals')).toEqual({
      name: 'goals',
      title: 'Goals',
      description: 'What a playbook should achieve for the person and how they will know it worked.',
      text: goalsGuideIn(goalsPage, { messages: false }),
    });
    expect([servedWithEverythingAndGoalsUntold.messages, servedWithEverythingAndGoals.messages]).toEqual([false, true]);
  });

  it('keeps notify, being told and the notification function only on the lines that say messages are off', () => {
    const offLines = linesInsideWithoutBlocks(goalsPage);
    const telling = untold.split('\n').filter((line) => toldWords.test(line));

    expect(telling.filter((line) => !offLines.has(line))).toEqual([]);
    expect(untold).not.toMatch(/<!--/u);
    expect(told).not.toMatch(/<!--/u);
    expect(told).toMatch(/notification function/u);
  });

  it('keeps both renditions within the bytes of a guide, with no run of blank lines', () => {
    expect(byteLengthOf(untold)).toBeLessThanOrEqual(mostGuideBytes);
    expect(byteLengthOf(told)).toBeLessThanOrEqual(mostGuideBytes);
    expect([untold.includes('\n\n\n'), told.includes('\n\n\n')]).toEqual([false, false]);
  });

  it('asks only for the goal and how they will know it worked in the start guide, the terminology, the recipe and the prompt', () => {
    const start = textOf(servedWithEverythingAndGoalsUntold.named('start'));
    const terminology = textOf(servedWithEverythingAndGoalsUntold.named('terminology'));
    const firstPlaybook = String(recipeTextsOf(servedWithEverythingAndGoalsUntold)['first-playbook']);

    expect([start, terminology].map((text) => toldWords.test(text))).toEqual([false, false]);
    expect(start).toContain(
      "A goal is what the playbook is for, in the person's own words: what it should achieve for them and how they will know it worked.",
    );
    expect(terminology).toContain(
      "- Goal: What a playbook is for, in the person's own words, with how they will know it worked. A playbook owns its goals, and the first one leads.",
    );
    expect(terminology).not.toContain('- Message:');
    expect(terminology).not.toContain('- Summary:');
    expect(firstPlaybook.replace(goalsInFirstPlaybook.replace(toldInFirstPlaybook, ''), '')).toBe(
      String(recipeTextsOf(servedWithEverything)['first-playbook']),
    );
  });
});
