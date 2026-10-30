import { asSentence, counted, listed, quoted, type Noun } from '@on.auto/operations';

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
