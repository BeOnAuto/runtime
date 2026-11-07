import { pointerOf, type SchemaIssue } from '@on.auto/json-schema';
import type { Schema } from 'effect';

import { valueFactsOf, valueFlags, type ValueFacts } from './portable-flags.ts';
import {
  acceptsNull,
  choicesOf,
  definedIn,
  definitionPathOf,
  definitionsOf,
  entriesOf,
  enumValuesOf,
  isJsonList,
  isJsonObject,
  isMap,
  isObjectRoot,
  joined,
  recursiveReferences,
  stringsOf,
  typesOf,
  type Definitions,
} from './schema-definitions.ts';
import type { Path } from './schema-nodes.ts';
import { mapWordsOf, movedToWords, withWords, wordsOf } from './schema-words.ts';

export interface Lowered {
  readonly sent: Schema.JsonObject;
  readonly flagged: readonly SchemaIssue[];
}

interface Lowering {
  readonly definitions: Definitions;
  readonly recursive: ReadonlySet<string>;
  readonly flag: (path: Path, detail: string) => void;
  readonly refer: (reference: string) => void;
}

const annotations: ReadonlySet<string> = new Set([
  '$comment',
  'title',
  'default',
  'examples',
  'readOnly',
  'writeOnly',
  'deprecated',
  '$schema',
  '$id',
]);

const besideAChoice: ReadonlySet<string> = new Set(['description', '$defs', 'definitions', ...annotations]);

const keyKeywords: ReadonlySet<string> = new Set(['type', 'enum', 'const', 'description', ...annotations]);

const unportableKeywords: Readonly<Record<string, string>> = {
  allOf: 'allOf, which strict structured outputs refuse',
  not: 'not, which strict structured outputs refuse',
  prefixItems: 'a list of fixed positions (prefixItems)',
};

function typeValueOf(types: readonly string[]): Schema.Json {
  return types.length === 1 ? types.join('') : types;
}

function kindOf(value: Schema.Json): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'integer' : 'number';
  }
  return typeof value;
}

function enumKindsOf(values: readonly Schema.Json[]): readonly string[] {
  const kinds = new Set(values.map((value) => kindOf(value)));
  return [...kinds].filter((kind) => kind !== 'integer' || !kinds.has('number'));
}

function sentReferenceOf(reference: string): string {
  return reference.replace(/^#\/definitions\//u, '#/$defs/');
}

function nullable(sent: Schema.JsonObject): Schema.JsonObject {
  if (sent['type'] === undefined) {
    const { description, anyOf, ...rest } = sent;
    const branches = isJsonList(anyOf) ? anyOf : [rest];
    return joined({ anyOf: [...branches, { type: 'null' }] }, description === undefined ? {} : { description });
  }
  const values = enumValuesOf(sent);
  return joined(
    sent,
    { type: typeValueOf([...typesOf(sent), 'null']) },
    values === undefined ? {} : { enum: [...values, null] },
  );
}

function flagUnportableKeywords(node: Schema.JsonObject, path: Path, lowering: Lowering): void {
  for (const [keyword, detail] of Object.entries(unportableKeywords)) {
    if (node[keyword] !== undefined) {
      lowering.flag([...path, keyword], detail);
    }
  }
}

function loweredReference(
  node: Schema.JsonObject,
  reference: string,
  path: Path,
  lowering: Lowering,
): Schema.JsonObject {
  if (lowering.recursive.has(reference)) {
    lowering.flag(path, `the definition ${reference}, which refers to itself`);
    return { $ref: sentReferenceOf(reference) };
  }
  const siblings = Object.keys(node).filter((keyword) => keyword !== '$ref' && !annotations.has(keyword));
  if (siblings.length === 0) {
    lowering.refer(reference);
    return { $ref: sentReferenceOf(reference) };
  }
  const unmovable = siblings.filter((keyword) => keyword !== 'description' && !movedToWords.has(keyword));
  if (unmovable.length > 0) {
    lowering.flag(path, `keywords beside $ref: ${unmovable.join(', ')}`);
  }
  return withWords(lowerNode(definedIn(lowering.definitions, node), path, lowering), wordsOf(node));
}

function sharesItsType(node: Schema.JsonObject, siblings: readonly string[], definitions: Definitions): boolean {
  const types = typesOf(node);
  const typedWithin = (choice: Schema.Json | undefined): boolean =>
    isJsonObject(choice) &&
    (typesOf(choice).length > 0 || enumValuesOf(choice) !== undefined) &&
    typesOf(choice).every((type) => types.includes(type));
  return (
    siblings.join(',') === 'type' && choicesOf(node).every((choice) => typedWithin(definedIn(definitions, choice)))
  );
}

function loweredChoice(node: Schema.JsonObject, path: Path, lowering: Lowering): Schema.JsonObject {
  const keyword = node['anyOf'] === undefined ? 'oneOf' : 'anyOf';
  const siblings = Object.keys(node).filter(
    (key) => key !== keyword && !besideAChoice.has(key) && !movedToWords.has(key),
  );
  if (siblings.length > 0 && !sharesItsType(node, siblings, lowering.definitions)) {
    lowering.flag(path, `${keyword} beside ${siblings.join(', ')}`);
  }
  const branches = choicesOf(node).map((choice, index) => lowerNode(choice, [...path, keyword, index], lowering));
  return withWords({ anyOf: branches }, wordsOf(node));
}

function loweredKey(node: Schema.JsonObject, path: Path, lowering: Lowering): Schema.JsonObject {
  const names = node['propertyNames'];
  const rules = isJsonObject(names) ? names : {};
  const untold = Object.keys(rules).filter((keyword) => !keyKeywords.has(keyword) && !movedToWords.has(keyword));
  if (untold.length > 0) {
    lowering.flag([...path, 'propertyNames'], `rules of the keys that cannot be put into words: ${untold.join(', ')}`);
  }
  const values = enumValuesOf(rules);
  return withWords(joined({ type: 'string' }, values === undefined ? {} : { enum: values }), wordsOf(rules));
}

function loweredMap(node: Schema.JsonObject, path: Path, lowering: Lowering): Schema.JsonObject {
  const entry = {
    type: 'object',
    properties: {
      key: loweredKey(node, path, lowering),
      value: lowerNode(node['additionalProperties'], [...path, 'additionalProperties'], lowering),
    },
    required: ['key', 'value'],
    additionalProperties: false,
  };
  const type = typesOf(node).includes('null') ? ['array', 'null'] : 'array';
  return { type, items: entry, description: mapWordsOf(node) };
}

function sentTypeOf({ types, values, describesObject }: ValueFacts): Schema.JsonObject {
  if (types.length > 0) {
    return { type: typeValueOf(types) };
  }
  if (values !== undefined) {
    return { type: typeValueOf(enumKindsOf(values)) };
  }
  return describesObject ? { type: 'object' } : {};
}

function loweredObject(node: Schema.JsonObject, path: Path, lowering: Lowering): Schema.JsonObject {
  const properties = entriesOf(node['properties']);
  const required = new Set(stringsOf(node['required']));
  const sentProperties = properties.map(([name, property]): readonly [string, Schema.Json] => {
    const sent = lowerNode(property, [...path, 'properties', name], lowering);
    return [name, required.has(name) || acceptsNull(lowering.definitions, property) ? sent : nullable(sent)];
  });
  return {
    properties: Object.fromEntries(sentProperties),
    required: properties.map(([name]) => name),
    additionalProperties: false,
  };
}

function loweredValue(node: Schema.JsonObject, path: Path, lowering: Lowering): Schema.JsonObject {
  const facts = valueFactsOf(node);
  for (const { below, detail } of valueFlags(facts, lowering.definitions)) {
    lowering.flag([...path, ...below], detail);
  }
  const items = node['items'];
  const lowered = joined(
    sentTypeOf(facts),
    facts.values === undefined ? {} : { enum: facts.values },
    items === undefined ? {} : { items: lowerNode(items, [...path, 'items'], lowering) },
    facts.describesObject ? loweredObject(node, path, lowering) : {},
  );
  return withWords(lowered, wordsOf(node));
}

function lowerNode(node: Schema.Json | undefined, path: Path, lowering: Lowering): Schema.JsonObject {
  if (!isJsonObject(node)) {
    lowering.flag(path, node === false ? 'a schema no value matches' : 'a value of any type');
    return {};
  }
  flagUnportableKeywords(node, path, lowering);
  const reference = node['$ref'];
  if (typeof reference === 'string') {
    return loweredReference(node, reference, path, lowering);
  }
  if (choicesOf(node).length > 0) {
    return loweredChoice(node, path, lowering);
  }
  return isMap(node) ? loweredMap(node, path, lowering) : loweredValue(node, path, lowering);
}

function withoutDefinitions(root: Schema.JsonObject): Schema.JsonObject {
  return Object.fromEntries(
    Object.entries(root).filter(
      ([keyword]: readonly [string, Schema.Json]) => keyword !== '$defs' && keyword !== 'definitions',
    ),
  );
}

function wrapped(lowered: Schema.JsonObject): Schema.JsonObject {
  return { type: 'object', properties: { value: lowered }, required: ['value'], additionalProperties: false };
}

function loweredDefinitions(lowering: Lowering, nextReferred: () => string | undefined): Schema.JsonObject {
  const lowered = new Map<string, Schema.JsonObject>();
  for (let next = nextReferred(); next !== undefined; next = nextReferred()) {
    if (!lowered.has(next)) {
      lowered.set(next, lowerNode(lowering.definitions.get(next), definitionPathOf(next), lowering));
    }
  }
  return Object.fromEntries(
    [...lowered].map(([reference, sent]: readonly [string, Schema.JsonObject]) => [
      definitionPathOf(reference).slice(1).join('/'),
      sent,
    ]),
  );
}

export function loweredSchema(root: Schema.JsonObject): Lowered {
  const flagged: SchemaIssue[] = [];
  const referred: string[] = [];
  const definitions = definitionsOf(root);
  const lowering: Lowering = {
    definitions,
    recursive: recursiveReferences(definitions),
    flag: (path, detail) => {
      flagged.push({ pointer: pointerOf(path), detail });
    },
    refer: (reference) => {
      referred.push(reference);
    },
  };
  if (root['$defs'] !== undefined && root['definitions'] !== undefined) {
    lowering.flag([], 'definitions under both $defs and definitions');
  }
  const body = lowerNode(withoutDefinitions(root), [], lowering);
  const top = isObjectRoot(root) ? body : wrapped(body);
  const sentDefinitions = loweredDefinitions(lowering, () => referred.pop());
  return {
    sent: Object.keys(sentDefinitions).length === 0 ? top : joined(top, { $defs: sentDefinitions }),
    flagged,
  };
}
