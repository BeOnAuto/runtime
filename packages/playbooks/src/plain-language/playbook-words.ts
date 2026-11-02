import { asSentence, counted, listed, quoted, type Noun } from '@on.auto/phrasing';

import type { Playbook } from '../registry/playbook.ts';

const playbookNoun: Noun = { one: 'playbook', other: 'playbooks' };

const retiredPlaybookNoun: Noun = { one: 'retired playbook', other: 'retired playbooks' };

const mostNamed = 20;

export function playbookNamed({ name }: Pick<Playbook, 'name'>): string {
  return `the playbook ${quoted(name)}`;
}

export function purposeOf({ description }: Pick<Playbook, 'description'>, withoutDescription = ''): string {
  return description.trim() === '' ? withoutDescription : ` What it is for: ${asSentence(description)}`;
}

function namesOf(playbooks: readonly Playbook[]): string {
  const named = playbooks.slice(0, mostNamed).map(({ name }) => quoted(name));
  const others = playbooks.length - named.length;
  return listed(others === 0 ? named : [...named, `${others} more`]);
}

function inUse(playbooks: readonly Playbook[]): string {
  if (playbooks.length === 0) {
    return 'There is no playbook in use that this connection may see.';
  }
  const verb = playbooks.length === 1 ? 'is' : 'are';
  return `There ${verb} ${counted(playbooks.length, playbookNoun)}: ${namesOf(playbooks)}.`;
}

function retiredOf(playbooks: readonly Playbook[]): string {
  return playbooks.length === 0
    ? ''
    : ` Also listed, ${counted(playbooks.length, retiredPlaybookNoun)}: ${namesOf(playbooks)}.`;
}

export function playbooksListed(playbooks: readonly Playbook[]): string {
  return `${inUse(playbooks.filter(({ status }) => status === 'active'))}${retiredOf(playbooks.filter(({ status }) => status === 'retired'))}`;
}

const welcomeSentences = [
  'This organization has no playbooks yet.',
  'A playbook keeps work your team can use again. Its workflows coordinate functions that reason, interact, predict, recall and compute.',
  'Unless the person has already said what they want, ask what they want done, and offer three starts: set up a first playbook, connect a service they use, or hear what Auto can do for their team.',
  'In Studio, your team can review playbooks and run results.',
  'You can also manage workflows, connections, members and billing there.',
];

export function welcomeOf(studio: string | undefined): string {
  return [...welcomeSentences, ...(studio === undefined ? [] : [studio])].join(' ');
}
