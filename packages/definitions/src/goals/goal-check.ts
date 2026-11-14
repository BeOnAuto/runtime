import { counted, type Noun } from '@on.auto/phrasing';

import {
  choiceIn,
  findingsOf,
  flagIn,
  isMapping,
  listIn,
  mappingIn,
  nameIn,
  onlyKnownKeys,
  pointerOf,
  presentIn,
  textIn,
  type Holder,
} from './goal-fields.ts';
import { agentIssue, personIssue, type GoalIssue } from './goal-issues.ts';
import { notifyIn, successIn } from './goal-outcome.ts';
import { CalendarUnitSchema, MarkedBySchema, WeekdaySchema, goalIdPattern } from './goals-document.ts';

export interface PlaybookNaming {
  readonly name: string;
  readonly description?: string;
}

const goalKeys = ['id', 'name', 'statement', 'per', 'window', 'success', 'milestones', 'notify', 'retired'];

const milestoneKeys = ['id', 'label', 'by'];

const windowKeys = ['after', 'for', 'grace', 'calendar', 'time_zone', 'days'];

const goalNameLength = { least: 2, most: 40 };

const unshownOrBreaking = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Zl}\p{Zp}]/u;

const fewestMilestones = 3;

const mostMilestones = 7;

function comparable(words: string): string {
  return words.toLowerCase().replaceAll(/[^\p{L}\p{N}]/gu, '');
}

function repeatsTheNaming(statement: string, naming: PlaybookNaming | undefined): boolean {
  return [naming?.name, naming?.description].some(
    (words) => words !== undefined && comparable(words) === comparable(statement),
  );
}

interface NamedMilestone {
  readonly id: string;
  readonly at: string;
}

function milestoneIn(goal: Holder, milestone: unknown, at: string, what: string): readonly NamedMilestone[] {
  if (!isMapping(milestone)) {
    goal.findings.add(agentIssue(at, `${what} is a set of keys and their values`));
    return [];
  }
  const holder: Holder = { mapping: milestone, pointer: at, findings: goal.findings };
  const lacking = (key: string, words: string) => () => agentIssue(pointerOf(holder, key), `${what} ${words}`);
  onlyKnownKeys(holder, what, milestoneKeys);
  const id = nameIn(holder, { key: 'id', what: `The id of ${what}`, need: lacking('id', 'has no id') }, goalIdPattern);
  textIn(
    holder,
    { key: 'label', what: `The label of ${what}`, need: lacking('label', 'has no label') },
    {
      least: 2,
      most: 80,
    },
  );
  choiceIn(
    holder,
    { key: 'by', what: `Who marks ${what}`, need: lacking('by', 'does not say who marks it') },
    MarkedBySchema.literals,
  );
  return id === undefined ? [] : [{ id, at: pointerOf(holder, 'id') }];
}

const milestoneNoun: Noun = { one: 'milestone', other: 'milestones' };

function milestoneIdsIn(goal: Holder, name: string): readonly string[] {
  const milestones = listIn(goal, { key: 'milestones', what: `The milestones of ${name}`, need: 'optional' });
  if (milestones === undefined) {
    return [];
  }
  const pointer = pointerOf(goal, 'milestones');
  if (milestones.length > 0 && (milestones.length < fewestMilestones || milestones.length > mostMilestones)) {
    goal.findings.add(
      agentIssue(pointer, `${name} names ${counted(milestones.length, milestoneNoun)}; name none, or three to seven`),
    );
  }
  const named = milestones.flatMap((milestone, index) =>
    milestoneIn(goal, milestone, `${pointer}/${String(index)}`, `milestone ${String(index + 1)} of ${name}`),
  );
  for (const [index, { id, at }] of named.entries()) {
    if (named.findIndex((other) => other.id === id) < index) {
      goal.findings.add(agentIssue(at, `${name} names the milestone ${id} more than once`));
    }
  }
  return named.map(({ id }) => id);
}

interface Windowing {
  readonly windowed: boolean;
  readonly calendar: boolean;
}

const duration = { least: 1, most: 40 };

function afterWindowIn(window: Holder, name: string, milestones: readonly string[]): void {
  const what = `The window of ${name}`;
  const named = nameIn(window, { key: 'after', what: `The after of ${name}`, need: 'optional' }, goalIdPattern);
  if (named !== undefined && !milestones.includes(named)) {
    window.findings.add(
      agentIssue(pointerOf(window, 'after'), `${what} starts after ${named}, which is no milestone of the goal`),
    );
  }
  textIn(
    window,
    {
      key: 'for',
      what: `How long ${name} runs`,
      need: () => agentIssue(pointerOf(window, 'for'), `${what} says after and not for how long`),
    },
    duration,
  );
}

function daysIn(window: Holder, name: string): void {
  const days = listIn(window, { key: 'days', what: `The days of ${name}`, need: 'optional' });
  if (days === undefined) {
    return;
  }
  const pointer = pointerOf(window, 'days');
  if (days.length === 0) {
    window.findings.add(
      agentIssue(pointer, `The days of ${name} name at least one day; leave days out to judge every day`),
    );
  }
  const holder: Holder = { mapping: Object.fromEntries(days.entries()), pointer, findings: window.findings };
  for (const [index, day] of days.entries()) {
    const key = String(index);
    const named = choiceIn(
      holder,
      { key, what: `Day ${String(index + 1)} of ${name}`, need: 'optional' },
      WeekdaySchema.literals,
    );
    if (named !== undefined && days.indexOf(day) < index) {
      window.findings.add(agentIssue(pointerOf(holder, key), `The days of ${name} name ${named} more than once`));
    }
  }
}

function calendarWindowIn(window: Holder, name: string): void {
  const unit = choiceIn(
    window,
    { key: 'calendar', what: `The calendar of ${name}`, need: 'optional' },
    CalendarUnitSchema.literals,
  );
  textIn(window, { key: 'time_zone', what: `The time zone of ${name}`, need: 'optional' }, { least: 1, most: 64 });
  if (presentIn(window.mapping, 'days') && unit !== 'day') {
    window.findings.add(
      agentIssue(pointerOf(window, 'days'), `The window of ${name} takes days only with calendar: day`),
    );
    return;
  }
  daysIn(window, name);
}

function keyOnlyWith(window: Holder, what: string, key: string, kind: string): void {
  if (presentIn(window.mapping, key) && !presentIn(window.mapping, kind)) {
    window.findings.add(agentIssue(pointerOf(window, key), `${what} takes ${key} only with ${kind}`));
  }
}

function windowIn(goal: Holder, name: string, milestones: readonly string[]): Windowing {
  const what = `The window of ${name}`;
  const window = mappingIn(goal, { key: 'window', what, need: 'optional' });
  if (window === undefined) {
    return { windowed: presentIn(goal.mapping, 'window'), calendar: false };
  }
  onlyKnownKeys(window, what, windowKeys);
  const after = presentIn(window.mapping, 'after');
  const calendar = presentIn(window.mapping, 'calendar');
  if (after === calendar) {
    window.findings.add(agentIssue(window.pointer, `${what} has either after or calendar, not both or neither`));
  }
  textIn(window, { key: 'grace', what: `The grace of ${name}`, need: 'optional' }, duration);
  if (after) {
    afterWindowIn(window, name, milestones);
  }
  if (calendar) {
    calendarWindowIn(window, name);
  }
  keyOnlyWith(window, what, 'for', 'after');
  keyOnlyWith(window, what, 'time_zone', 'calendar');
  keyOnlyWith(window, what, 'days', 'calendar');
  return { windowed: true, calendar };
}

function goalNameIn(goal: Holder, name: string): void {
  const written = textIn(goal, { key: 'name', what: `The name of ${name}`, need: 'optional' }, goalNameLength);
  if (written !== undefined && unshownOrBreaking.test(written)) {
    goal.findings.add(
      agentIssue(
        pointerOf(goal, 'name'),
        `The name of ${name} is plain text on one line, with no tab and no character that is not shown`,
      ),
    );
  }
}

function statementIn(goal: Holder, name: string, naming: PlaybookNaming | undefined): void {
  const statement = textIn(
    goal,
    {
      key: 'statement',
      what: `The statement of ${name}`,
      need: () => personIssue(pointerOf(goal, 'statement'), 'change', `${name} has no statement.`),
    },
    { least: 12, most: 200 },
  );
  if (statement !== undefined && repeatsTheNaming(statement, naming)) {
    goal.findings.add(
      personIssue(
        pointerOf(goal, 'statement'),
        'change',
        `The statement of ${name} only repeats the playbook's name or description.`,
      ),
    );
  }
}

export function goalIssuesOf(value: unknown, index: number, naming: PlaybookNaming | undefined): readonly GoalIssue[] {
  const pointer = `/${String(index)}`;
  const numbered = `goal number ${String(index + 1)}`;
  if (!isMapping(value)) {
    return [agentIssue(pointer, `${numbered} is a set of keys and their values`)];
  }
  const goal: Holder = { mapping: value, pointer, findings: findingsOf() };
  onlyKnownKeys(goal, numbered, goalKeys);
  const id = nameIn(
    goal,
    {
      key: 'id',
      what: `The id of ${numbered}`,
      need: () => agentIssue(pointerOf(goal, 'id'), `${numbered} has no id`),
    },
    goalIdPattern,
  );
  const name = id === undefined ? numbered : `the goal ${id}`;
  goalNameIn(goal, name);
  statementIn(goal, name, naming);
  const per = textIn(goal, { key: 'per', what: `The per of ${name}`, need: 'optional' }, { least: 2, most: 40 });
  const milestones = milestoneIdsIn(goal, name);
  const { windowed, calendar } = windowIn(goal, name, milestones);
  if (calendar && per !== undefined) {
    goal.findings.add(
      agentIssue(pointerOf(goal, 'per'), `${name} is judged thing by thing, which a calendar window does not allow`),
    );
  }
  const { settles } = successIn(goal, name);
  if (settles === 'at_close' && !windowed) {
    goal.findings.add(agentIssue(`${pointer}/success/settles`, `${name} settles at_close, which needs a window`));
  }
  notifyIn(goal, name, windowed);
  flagIn(goal, { key: 'retired', what: `Whether ${name} is retired`, need: 'optional' });
  return goal.findings.found();
}
