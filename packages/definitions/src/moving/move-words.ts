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

const listedFirst =
  '`definitions` lists each one by `type` and `name`, with everything each one uses and everything left in this playbook that uses one of them; a call that leaves one out moves nothing and says which to add.';

export const moveDescription = [
  'Moves functions and workflows from this playbook to another playbook of the org and returns them: each keeps its versions, its runs and its page, and from then on it is read, run and changed in the other playbook under the same name.',
  'Use move_definitions when the person asks to move a function or a workflow to another playbook.',
  listedFirst,
  'Nothing moves while one of them has a run that has not ended, or while the other playbook has a definition of the same type and name, even a retired one.',
].join(' ');

export const moveWithGoalsDescription = [
  'Moves functions, workflows and goals from this playbook to another playbook of the org: each keeps its versions, runs, page and results, and is from then on read, run, judged and changed there under the same name.',
  'Use move_definitions when the person asks to move a function, a workflow or a goal to another playbook.',
  listedFirst,
  '`goals` lists goals by id; list in `definitions` every workflow that serves one of them, since a goal moves with its workflows.',
  'Nothing moves while one of them has a run that has not ended, or while the other playbook has one of the same type and name, even a retired one.',
].join(' ');

export const toDescription = 'The id of the playbook to move the definitions to';

export const toWithGoalsDescription = 'The id of the playbook to move them to';

export const definitionsDescription =
  'The definitions to move, each by its `type` and `name`, with everything each one uses';

export const definitionsWithGoalsDescription = `${definitionsDescription}; leave it out only to move goals that no workflow serves`;

export const goalsDescription = "The ids of the goals to move; each keeps its id, its results and the person's yes";

export const goalsMovedDescription = 'The ids of the goals that moved';

export const forceDescription =
  'true moves them although the other playbook has no access to a connection one of them needs; the runs of the one that needs it fail there until that playbook has access. Leave it out unless the person said to move anyway';

export const moveTask = 'move a function or workflow to another playbook';

export const moveWithGoalsTask = 'move a function, workflow or goal to another playbook';

export const takenOnAMove = {
  why: 'the other playbook already has a definition of the same name',
  remedy: 'A definition keeps its name when it moves; the details below say which name and what the person can do.',
};

export const takenOnAMoveWithGoals = {
  why: 'the other playbook already has a definition of the same name or a goal of the same id',
  remedy:
    'A definition keeps its name when it moves, and a goal keeps its id; the details below say which one and what the person can do.',
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

export function namedWithGoalsFirst(
  words: DefinitionWords,
  goals: readonly string[],
  definitions: readonly Named[],
): string {
  return listed([
    ...goals.map((id) => `the goal ${id}`),
    ...definitions.map(({ type, name }) => words.named(type, name)),
  ]);
}

export interface CountsMoved {
  readonly goals: number;
  readonly definitions: number;
}

function goalsAloneMoved(goals: number): string {
  return goals === 1
    ? "Its results moved with it, and so did the person's yes if they gave one. It is now read and changed there."
    : "Their results moved with them, and so did the person's yes to each, if they gave one. Each is now read and changed there.";
}

function goalsWithDefinitionsMoved({ goals, definitions }: CountsMoved): string {
  return [
    goals === 1
      ? "The goal's results moved with it, and so did the person's yes if they gave one."
      : "The goals' results moved with them, and so did the person's yes to each, if they gave one.",
    definitions === 1
      ? "The definition's versions and runs moved with it. Each is now read and changed there, and the definition is run there."
      : "The definitions' versions and runs moved with them. Each is now read and changed there, and the definitions are run there.",
  ].join(' ');
}

export function goalMoveOutcome(named: string, to: string, counts: CountsMoved): string {
  const moved = counts.definitions === 0 ? goalsAloneMoved(counts.goals) : goalsWithDefinitionsMoved(counts);
  return `Moved ${named} to the playbook ${to}. ${moved}`;
}

export const neitherGiven = 'Give `definitions`, `goals` or both';

export function noGoalWords(id: string): string {
  return `This playbook has no goal with the id ${id}; get_playbook shows its goals and their ids`;
}

function theWorkflows(names: readonly string[]): string {
  return listed(names.map((name) => `the workflow ${name}`));
}

export function goalInUseWords(id: string, workflows: readonly string[]): string {
  const staying = theWorkflows(workflows);
  return `The goal ${id} is served by ${staying}, which this call leaves in this playbook; add ${staying} to \`definitions\` so they move together`;
}

export function servesAGoalLeftWords(workflow: string, other: string): string {
  return `The workflow ${workflow} also serves the goal ${other}, which this call leaves in this playbook. Ask the person: they can move ${other} too, and then call again with ${other} in \`goals\`; or they can have ${workflow} stop serving ${other}, and then save ${workflow} with update_definition without its \`contributes\` entry for ${other} and call again`;
}

export function sentThroughByAGoalLeftWords(stays: string, through: string, to: string): string {
  return `The goal ${stays}, which this call leaves in this playbook, also sends its messages through the interaction function ${through}. Ask the person: they can move ${stays} too, and then call again with ${stays} in \`goals\`; or they can keep ${through} here, and then create an interaction function ${through} in ${to} and call again without ${through} in \`definitions\``;
}

export function tooManyNamedWords(named: number, most: number): string {
  return `This call names ${String(named)} definitions and goals, and one call moves at most ${String(most)} of them; move what can move without the rest in a call of its own, or tell the person if nothing can`;
}

export function messagesThroughWords(id: string, through: string, to: string): string {
  return `The goal ${id} sends its messages through the interaction function ${through}, and the playbook ${to} has none of that name; add the interaction function ${through} to \`definitions\` so it moves too, or create one of that name in ${to} first`;
}

export function goalTakenWords(to: string, id: string, retired: boolean): string {
  return retired
    ? `The playbook ${to} has a retired goal ${id}, which keeps its id while retired, and a goal keeps its id when it moves, so it cannot move there; tell the person, who can choose another playbook, or rename the one you are moving with update_playbook's \`rename_goal\` and then move it`
    : `The playbook ${to} already has a goal ${id}, and a goal keeps its id when it moves, so it cannot move there; tell the person, who can choose another playbook, or rename it with update_playbook's \`rename_goal\` and then move it`;
}

export function goalsKeptBeyondWords(to: string, kept: number, most: number): string {
  return `The playbook ${to} keeps ${String(kept)} goals, and a playbook may keep at most ${String(most)}; tell the person, who can choose another playbook or move one of its goals out first`;
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
