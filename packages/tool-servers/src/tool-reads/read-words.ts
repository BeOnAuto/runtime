import { capitalized, counted, type Noun } from '@on.auto/phrasing';
import { Predicate, type Schema } from 'effect';

import type { ToolMark } from '../bounds/tool-results.ts';
import type { ToolReference } from '../names/tool-reference.ts';
import { inWords, namesListed, toolInWords } from '../names/tool-words.ts';
import type { DryRun } from './dry-run-schema.ts';

interface Described extends ToolReference {
  readonly input_schema: Schema.JsonObject;
  readonly mark: ToolMark;
}

const argumentNoun: Noun = { one: 'argument', other: 'arguments' };

export const readingTask = {
  introspect: 'describe a tool of a tool server',
  dry_run: 'dry run a call of a tool of a tool server',
} as const;

export function toolRead(verb: string, asked: ToolReference): string {
  return `${verb} ${toolInWords(asked)}`;
}

function argumentsTaken({ input_schema: { properties } }: Described): string {
  const names = Predicate.isObject(properties) ? Object.keys(properties).map((name) => inWords(name)) : [];
  return names.length === 0
    ? 'takes no arguments'
    : `takes ${counted(names.length, argumentNoun)}, ${namesListed(names)},`;
}

const markedInWords: Readonly<Record<ToolMark, string>> = {
  reads: 'is marked reads, so it only reads',
  acts: 'is marked acts, so it may change something',
  unmarked: 'is unmarked, so it counts as one that may change something',
};

export function introspected(described: Described): string {
  return `${capitalized(toolInWords(described))} ${argumentsTaken(described)} and ${markedInWords[described.mark]}; what it does and what it takes are in the details.`;
}

function argumentsInWords({ arguments: checked }: DryRun): string {
  if (checked === null) {
    return '';
  }
  if (checked.valid === null) {
    return ', though its arguments could not be checked on this server';
  }
  return checked.valid ? ', and its arguments are what it takes' : ', but its arguments are not what it takes';
}

function unreachedOf({ because }: DryRun['server']): string {
  if (because === 'key_refused') {
    return 'its tool server did not accept the key this server gives it';
  }
  if (because === 'scope_lacking') {
    return 'its tool server asks for a scope its credential lacks';
  }
  return because === 'connection_not_allowed'
    ? 'the rules whoever runs this server sets for connections do not allow its tool server'
    : 'its tool server could not be asked just now';
}

function whyNot({ caller_may: callerMay, playbook_retired: retired, allowed, server }: DryRun): readonly string[] {
  return [
    ...(callerMay ? [] : ['the caller may not change this playbook, which a call needs']),
    ...(retired ? ['the playbook is retired and cannot change until it is restored'] : []),
    ...(allowed ? [] : ['whoever runs this server does not allow the tool']),
    ...(server.reachable === 'yes' ? [] : [unreachedOf(server)]),
  ];
}

export function dryRunWords(answer: DryRun, asked: ToolReference): string {
  const call = `A call of ${toolInWords(asked)}`;
  if (!answer.would_run) {
    return `${call} would not be made now: ${whyNot(answer).join('; ')}.`;
  }
  const marked = answer.mark === null ? 'may change something' : markedInWords[answer.mark];
  return `${call} would be made now, and the tool ${marked}${argumentsInWords(answer)}.`;
}
