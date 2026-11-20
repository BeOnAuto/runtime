import { listed } from '@on.auto/phrasing';

import { definitionResourceLabel } from '../capability/function-terminology.ts';
import type { DefinitionWords } from '../plain-language/definition-words.ts';

export interface Named {
  readonly type: string;
  readonly name: string;
}

function theDefinitions(named: readonly Named[]): string {
  return listed(named.map(({ type, name }) => `the ${definitionResourceLabel(type)} ${name}`));
}

export const moveDescription = [
  'Moves functions and workflows from this playbook to another playbook of the org and returns them: each keeps its versions, its runs and its page, and from then on it is read, run and changed in the other playbook under the same name.',
  'Use move_definitions when the person asks to move a function or a workflow to another playbook.',
  '`definitions` lists each one by `type` and `name`, with everything each one uses and everything left in this playbook that uses one of them; a call that leaves one out moves nothing and says which to add.',
  'Nothing moves while one of them has a run that has not ended, or while the other playbook has a definition of the same type and name, even a retired one.',
].join(' ');

export const toDescription = 'The id of the playbook to move the definitions to';

export const definitionsDescription =
  'The definitions to move, each by its `type` and `name`, with everything each one uses';

export const forceDescription =
  'true moves them although the other playbook has no access to a connection one of them needs; the runs of the one that needs it fail there until that playbook has access. Leave it out unless the person said to move anyway';

export const moveTask = 'move a function or workflow to another playbook';

export const takenOnAMove = {
  why: 'the other playbook already has a definition of the same name',
  remedy: 'A definition keeps its name when it moves; the details below say which name and what the person can do.',
};

export function namedTogether(words: DefinitionWords, definitions: readonly Named[]): string {
  return listed(definitions.map(({ type, name }) => words.named(type, name)));
}

export function moveAttempt(named: string, to: string): string {
  return `move ${named} to the playbook ${to}`;
}

export function moveOutcome(named: string, to: string, count: number): string {
  return count === 1
    ? `Moved ${named} to the playbook ${to}. Its versions and runs moved with it, and it is now read, run and changed there.`
    : `Moved ${named} to the playbook ${to}. Their versions and runs moved with them, and each is now read, run and changed there.`;
}

export const toNamesThisPlaybook =
  '`to` names the playbook this call acts in; give the id of the playbook to move them to';

export function retiredWords({ type, name }: Named): string {
  return `The ${definitionResourceLabel(type)} ${name} is retired; restore_definition brings it back, and then it can move`;
}

export function incompleteWords({ type, name }: Named, missing: readonly Named[]): string {
  return `The ${definitionResourceLabel(type)} ${name} uses ${theDefinitions(missing)}, which this call leaves out; add them to \`definitions\` so they move together`;
}

export function inUseWords({ type, name }: Named, users: readonly Named[]): string {
  const staying = theDefinitions(users);
  return `The ${definitionResourceLabel(type)} ${name} is used by ${staying}, which this call leaves in this playbook; add ${staying} to \`definitions\` so they move together, or take ${name}, and whatever in the call uses it, out of \`definitions\``;
}

export function takenWords(to: string, { type, name }: Named, retired: boolean): string {
  const label = definitionResourceLabel(type);
  return retired
    ? `The playbook ${to} has a retired ${label} ${name}, which keeps its name while retired, and a definition keeps its name when it moves, so it cannot move there; tell the person, who can choose another playbook, or rename the one you are moving with update_definition and then move it`
    : `The playbook ${to} already has the ${label} ${name}, and a definition keeps its name when it moves, so it cannot move there; tell the person, who can choose another playbook, or rename it with update_definition and then move it`;
}

interface RunsNotEndedUse {
  readonly relation: string;
  readonly of: string;
}

interface RunsNotEndedOf {
  readonly holder: Named;
  readonly change: string;
  readonly use?: RunsNotEndedUse;
}

export function runsNotEndedSentence({ holder, change, use }: RunsNotEndedOf, count: number, runId: string): string {
  const { type, name } = holder;
  const held = `The ${definitionResourceLabel(type)} ${name}${use === undefined ? '' : `, which ${use.relation} ${use.of},`}`;
  const can = (opening: string) => `${use?.of ?? opening} can ${change}`;
  return count === 1
    ? `${held} has a run that has not ended, ${runId}; ${can('it')} once that run has ended, or once cancel_run has cancelled it, if the person says to stop it`
    : `${held} has ${count} runs that have not ended, ${runId} among them; list_runs with \`name\` ${name} and \`status\` started lists them. ${can('It')} once they have ended, or once cancel_run has cancelled each, if the person says to stop them`;
}

export function runsNotEndedWords(holder: Named, count: number, runId: string): string {
  return runsNotEndedSentence({ holder, change: 'move' }, count, runId);
}

export function connectionNotAccessibleWords(to: string, connection: string, { type, name }: Named): string {
  return `The playbook ${to} has no access to the connection ${connection}, which the ${definitionResourceLabel(type)} ${name} needs. Ask the person: they can give ${to} access to it in Studio (Settings, Connections, open the connection, then Change beside "Available to"), and then call again; or they can say to move anyway, and then call again with \`force\` set to true, though ${name} then fails there until ${to} has access`;
}
