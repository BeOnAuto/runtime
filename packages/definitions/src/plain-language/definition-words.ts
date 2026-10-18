import { alternatives, asSentence, capitalized, counted, listed, quoted, type Noun } from '@on.auto/operations';
import { Option, Schema } from 'effect';

import { defaultRunWords, type Capability, type RunWords } from '../capability/capability.ts';
import type { ListedDefinition } from '../registry/definition.ts';
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

export function definitionStanding(
  words: DefinitionWords,
  { type, name, status }: Pick<ListedDefinition, 'type' | 'name' | 'status'>,
): string {
  const named = capitalized(words.named(type, name));
  return status === 'active' ? `${named} is in use.` : `${named} has been retired; it can no longer be run or changed.`;
}

function namesOf(definitions: readonly ListedDefinition[]): string {
  const named = definitions.slice(0, mostNamed).map(({ name }) => quoted(name));
  const others = definitions.length - named.length;
  return listed(others === 0 ? named : [...named, `${others} more`]);
}

export function definitionsListed(noun: Noun, definitions: readonly ListedDefinition[]): string {
  const active = definitions.filter(({ status }) => status === 'active');
  const retired = definitions.filter(({ status }) => status === 'retired');
  const inUse =
    active.length === 0
      ? `This playbook has no ${noun.other} in use yet.`
      : `This playbook has ${counted(active.length, noun)}: ${namesOf(active)}.`;
  const retiredNoun = { one: `retired ${noun.one}`, other: `retired ${noun.other}` };
  return retired.length === 0
    ? inUse
    : `${inUse} Also listed, ${counted(retired.length, retiredNoun)}: ${namesOf(retired)}.`;
}
