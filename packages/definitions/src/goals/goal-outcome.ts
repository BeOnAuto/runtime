import { definitionNamePattern } from '../operations/definition-fields.ts';
import {
  choiceIn,
  finiteNumberIn,
  mappingIn,
  nameIn,
  onlyKnownKeys,
  pointerOf,
  presentIn,
  textIn,
  type Holder,
} from './goal-fields.ts';
import { agentIssue, personIssue } from './goal-issues.ts';
import { ToldSchema, SettlesSchema, type Told } from './goals-document.ts';

const successKeys = ['label', 'settles', 'target', 'passed', 'failed'];

const targetKeys = ['at_least', 'at_most'];

const notifyKeys = ['passed', 'failed', 'overdue', 'through', 'summary'];

const summaryKeys = ['cron', 'time_zone', 'through'];

const verdictWords = { least: 2, most: 40 };

function targetIn(success: Holder, goal: string): void {
  const target = mappingIn(success, {
    key: 'target',
    what: `The target of ${goal}`,
    need: () => personIssue(pointerOf(success, 'target'), 'conviction', `${goal} names no target.`),
  });
  if (target === undefined) {
    return;
  }
  onlyKnownKeys(target, `The target of ${goal}`, targetKeys);
  const named = targetKeys.filter((key) => presentIn(target.mapping, key));
  const [key] = named;
  if (named.length !== 1 || key === undefined) {
    target.findings.add(agentIssue(target.pointer, `The target of ${goal} has exactly one of at_least or at_most`));
    return;
  }
  finiteNumberIn(target, { key, what: `The target of ${goal}`, need: 'optional' });
}

interface Settling {
  readonly settles: string | undefined;
}

export function successIn(goal: Holder, name: string): Settling {
  const success = mappingIn(goal, {
    key: 'success',
    what: `The success of ${name}`,
    need: () => personIssue(pointerOf(goal, 'success'), 'conviction', `${name} does not say how success is judged.`),
  });
  if (success === undefined) {
    return { settles: undefined };
  }
  onlyKnownKeys(success, `The success of ${name}`, successKeys);
  const wanting = (key: string, about: string) => () => personIssue(pointerOf(success, key), 'conviction', about);
  textIn(
    success,
    { key: 'label', what: `The label of ${name}`, need: wanting('label', `${name} has no words for its number.`) },
    { least: 2, most: 200 },
  );
  const settles = choiceIn(
    success,
    {
      key: 'settles',
      what: `How ${name} settles`,
      need: () =>
        agentIssue(pointerOf(success, 'settles'), `${name} does not say whether it settles on_crossing or at_close`),
    },
    SettlesSchema.literals,
  );
  targetIn(success, name);
  for (const verdict of ['passed', 'failed']) {
    textIn(
      success,
      {
        key: verdict,
        what: `The ${verdict} words of ${name}`,
        need: wanting(verdict, `${name} has no words for when it ${verdict}.`),
      },
      verdictWords,
    );
  }
  return { settles };
}

type Change = 'passed' | 'failed' | 'overdue';

const changeWords: Readonly<Record<Change, string>> = {
  passed: 'passes',
  failed: 'fails',
  overdue: 'becomes overdue',
};

function summaryIn(notify: Holder, name: string): void {
  const summary = mappingIn(notify, { key: 'summary', what: `The summary of ${name}`, need: 'optional' });
  if (summary === undefined) {
    return;
  }
  onlyKnownKeys(summary, `The summary of ${name}`, summaryKeys);
  textIn(
    summary,
    {
      key: 'cron',
      what: `The schedule of the summary of ${name}`,
      need: () => personIssue(pointerOf(summary, 'cron'), 'rhythm', `The summary of ${name} has no schedule.`),
    },
    { least: 1, most: 200 },
  );
  textIn(
    summary,
    { key: 'time_zone', what: `The time zone of the summary of ${name}`, need: 'optional' },
    {
      least: 1,
      most: 64,
    },
  );
  nameIn(summary, { key: 'through', what: `The summary function of ${name}`, need: 'optional' }, definitionNamePattern);
  if (!presentIn(summary.mapping, 'through') && !presentIn(notify.mapping, 'through')) {
    summary.findings.add(
      personIssue(pointerOf(summary, 'through'), 'channel', `The summary of ${name} names nothing to send it through.`),
    );
  }
}

function toldIn(notify: Holder, change: Change, name: string, required: boolean): Told | undefined {
  return choiceIn(
    notify,
    {
      key: change,
      what: `How to tell the person that ${name} ${changeWords[change]}`,
      need: required
        ? () =>
            personIssue(
              pointerOf(notify, change),
              'hearing',
              `${name} does not say how to tell the person when it ${changeWords[change]}.`,
            )
        : 'optional',
    },
    ToldSchema.literals,
  );
}

export function notifyIn(goal: Holder, name: string, windowed: boolean): void {
  const notify = mappingIn(goal, { key: 'notify', what: `The notify of ${name}`, need: 'optional' });
  if (notify === undefined) {
    return;
  }
  onlyKnownKeys(notify, `The notify of ${name}`, notifyKeys);
  const told = new Set([
    toldIn(notify, 'passed', name, true),
    toldIn(notify, 'failed', name, true),
    toldIn(notify, 'overdue', name, windowed),
  ]);
  nameIn(
    notify,
    { key: 'through', what: `The notification function of ${name}`, need: 'optional' },
    definitionNamePattern,
  );
  summaryIn(notify, name);
  if (told.has('now') && !presentIn(notify.mapping, 'through')) {
    notify.findings.add(
      personIssue(
        pointerOf(notify, 'through'),
        'channel',
        `${name} asks to tell the person immediately and names no notification function.`,
      ),
    );
  }
  if (told.has('summary') && !presentIn(notify.mapping, 'summary')) {
    notify.findings.add(
      personIssue(pointerOf(notify, 'summary'), 'rhythm', `${name} asks for a summary and gives it no schedule.`),
    );
  }
}
