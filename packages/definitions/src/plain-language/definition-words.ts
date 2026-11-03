import { alternatives, asSentence, capitalized, counted, listed, quoted, type Noun } from '@on.auto/phrasing';
import { Option, Schema } from 'effect';

import { defaultRunWords, type Capability, type RunWords } from '../capability/capability.ts';
import { writtenInOf } from '../page/page-lines.ts';
import { carriesAPage } from '../page/page-yaml.ts';
import { isPlaybookFunctionType, type Definition, type ListedDefinition } from '../registry/definition.ts';
import { nameInWords } from './in-words.ts';

const mostNamed = 20;

const propertiesOf = Schema.decodeUnknownOption(
  Schema.Struct({ properties: Schema.Record(Schema.String, Schema.Unknown) }),
);

export interface DefinitionWords {
  readonly kinds: string;
  readonly allKinds: string;
  readonly nounOf: (type: string) => Noun;
  readonly named: (type: string, name: string) => string;
  readonly runWordsOf: (type: string | undefined) => RunWords;
  readonly deferralTypes: readonly string[];
}

const unknownNoun: Noun = { one: 'item', other: 'items' };

const offeredDefinitionOf = Schema.decodeUnknownOption(
  Schema.Struct({ type: Schema.String, name: Schema.String, render: Schema.optionalKey(Schema.Unknown) }),
);

export interface OfferedDefinition {
  readonly type: string;
  readonly name: string;
  readonly render?: unknown;
}

export function definitionWordsFor(capabilities: readonly Capability[]): DefinitionWords {
  const nounOf = (name: string) => capabilities.find((capability) => capability.type === name)?.noun ?? unknownNoun;
  return {
    kinds: alternatives(capabilities.map(({ noun }) => noun.one)),
    allKinds: listed(capabilities.map(({ noun }) => noun.other)),
    nounOf,
    named: (type, name) => `the ${nounOf(type).one} ${quoted(name)}`,
    runWordsOf: (name) => capabilities.find((capability) => capability.type === name)?.runWords ?? defaultRunWords,
    deferralTypes: [
      ...new Set([defaultRunWords.deferralType, ...capabilities.map(({ runWords }) => runWords.deferralType)]),
    ],
  };
}

function propertyWordsOf(schema: Schema.JsonObject | undefined): readonly string[] {
  return Option.match(propertiesOf(schema), {
    onNone: () => [],
    onSome: ({ properties }) => Object.keys(properties).map((name) => nameInWords(name)),
  });
}

function takesAndGives(inputs: readonly string[], outputs: readonly string[]): string {
  const gives = outputs.length === 0 ? '' : `gives back ${listed(outputs)}`;
  if (inputs.length === 0) {
    return gives === '' ? '' : ` It ${gives}.`;
  }
  return ` It takes ${listed(inputs)}${gives === '' ? '' : `, and ${gives}`}.`;
}

export function whatItDoes(
  definition: Pick<ListedDefinition, 'description' | 'input_schema' | 'output_schema'>,
): string {
  return definition.description === undefined
    ? takesAndGives(propertyWordsOf(definition.input_schema), propertyWordsOf(definition.output_schema))
    : ` What it does: ${asSentence(definition.description)}`;
}

const noPageYet = ' It has no page yet; the page guide says how to give it one.';

function presentsItsRuns(type: string): boolean {
  return type === 'workflow' || isPlaybookFunctionType(type);
}

export function pageWords({ type, source }: Pick<Definition, 'type' | 'source'>): string {
  return presentsItsRuns(type) && !carriesAPage(source, writtenInOf(type)) ? noPageYet : '';
}

const standingsInWords: Readonly<Record<ListedDefinition['status'], string>> = {
  active: 'is in use.',
  paused: 'is paused; it starts no runs until it is resumed.',
  retired: 'has been retired; it can no longer be run or changed.',
};

export function definitionStanding(
  words: DefinitionWords,
  { type, name, status }: Pick<ListedDefinition, 'type' | 'name' | 'status'>,
): string {
  return `${capitalized(words.named(type, name))} ${standingsInWords[status]}`;
}

function namesOf(definitions: readonly ListedDefinition[]): string {
  const named = definitions.slice(0, mostNamed).map(({ name }) => quoted(name));
  const others = definitions.length - named.length;
  return listed(others === 0 ? named : [...named, `${others} more`]);
}

function standingNoun(standing: string, noun: Noun): Noun {
  return { one: `${standing} ${noun.one}`, other: `${standing} ${noun.other}` };
}

function countedAndNamed(noun: Noun, definitions: readonly ListedDefinition[]): readonly string[] {
  return definitions.length === 0 ? [] : [`${counted(definitions.length, noun)}: ${namesOf(definitions)}`];
}

export function definitionsListed(noun: Noun, definitions: readonly ListedDefinition[]): string {
  const inStatus = (status: ListedDefinition['status']) =>
    definitions.filter((definition) => definition.status === status);
  const held = [
    ...countedAndNamed(noun, inStatus('active')),
    ...countedAndNamed(standingNoun('paused', noun), inStatus('paused')),
  ];
  const inUse =
    held.length === 0 ? `This playbook has no ${noun.other} in use yet.` : `This playbook has ${held.join(', and ')}.`;
  const retired = inStatus('retired');
  return retired.length === 0
    ? inUse
    : `${inUse} Also listed, ${counted(retired.length, standingNoun('retired', noun))}: ${namesOf(retired)}.`;
}

export function offeredAttemptFor(
  capabilities: readonly Capability[],
  verbOf: (offered: OfferedDefinition) => string,
): (input: unknown) => string | undefined {
  const words = definitionWordsFor(capabilities);
  const types: ReadonlySet<string> = new Set(capabilities.map(({ type }) => type));
  return (input) =>
    Option.getOrUndefined(
      Option.map(
        Option.filter(offeredDefinitionOf(input), ({ type }) => types.has(type)),
        (offered) => `${verbOf(offered)} ${words.named(offered.type, offered.name)}`,
      ),
    );
}
