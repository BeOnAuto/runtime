import { stringify } from 'yaml';

import { isMapping, type Mapping } from './goal-fields.ts';

export const experimentMilestones = [
  { id: 'chosen', label: 'Idea chosen', by: 'person' },
  { id: 'prepared', label: 'Package prepared', by: 'auto' },
  { id: 'live', label: 'Taken live', by: 'person' },
  { id: 'measured', label: 'Measured', by: 'auto' },
  { id: 'concluded', label: 'Lesson kept', by: 'person' },
];

export const experimentSuccess = {
  label: 'New paying customers traced to the experiment',
  settles: 'on_crossing',
  target: { at_least: 1 },
  passed: 'Brought a customer',
  failed: 'Brought no customer',
};

export const experiments = {
  id: 'paying-customers',
  statement: 'Bring in paying customers through my experiments.',
  per: 'experiment',
  window: { after: 'live', for: 'P7D', grace: 'P1D' },
  success: experimentSuccess,
  milestones: experimentMilestones,
  notify: {
    passed: 'now',
    failed: 'now',
    overdue: 'now',
    through: 'tell-owner',
    summary: { cron: '0 9 * * 5', time_zone: 'America/Los_Angeles', through: 'weekly-note' },
  },
};

export const controls = {
  id: 'controls-hold',
  statement: 'Every control passes its daily check.',
  window: { calendar: 'day', grace: 'PT1H' },
  success: {
    label: 'Failing controls',
    settles: 'on_crossing',
    target: { at_most: 0 },
    passed: 'All controls held',
    failed: 'A control failed',
  },
  notify: { passed: 'quiet', failed: 'now', overdue: 'now', through: 'tell-owner', summary: { cron: '0 9 * * 5' } },
};

export const oneOff = {
  id: 'first-customer',
  statement: 'Land the first paying customer.',
  success: {
    label: 'Paying customers',
    settles: 'on_crossing',
    target: { at_least: 1 },
    passed: 'Landed',
    failed: 'Missed',
  },
  notify: { passed: 'summary', failed: 'quiet', summary: { cron: '0 9 * * 1', through: 'weekly-note' } },
};

export function textOf(goals: unknown): string {
  return stringify(goals, { aliasDuplicateObjects: false });
}

type Path = readonly [string, ...string[]];

function nested(value: unknown, [key, ...rest]: Path, placed: (mapping: Mapping, key: string) => Mapping): Mapping {
  const mapping = isMapping(value) ? value : {};
  const [next, ...more] = rest;
  return next === undefined
    ? placed(mapping, key)
    : { ...mapping, [key]: nested(mapping[key], [next, ...more], placed) };
}

export function changed(goal: unknown, path: Path, value: unknown): Mapping {
  return nested(goal, path, (mapping, key) => ({ ...mapping, [key]: value }));
}

export function without(goal: unknown, path: Path): Mapping {
  return nested(goal, path, (mapping, key) =>
    Object.fromEntries(Object.entries(mapping).filter((entry: readonly [string, unknown]) => entry[0] !== key)),
  );
}
