import { Buffer } from 'node:buffer';

import { JsonPointer, Predicate, type Schema } from 'effect';

import type { AnswerSchemas } from './api-parameters.ts';
import { isSchemaObject, type SchemaObject } from './schema-translation.ts';

const mostReferenceHops = 8;

const definitionReference = '#/$defs/';

const composedSchemas = ['allOf', 'anyOf', 'oneOf'];

const base64Text = /^(?:[A-Za-z0-9+/]+|[A-Za-z0-9_-]+)={0,2}$/u;

const whitespaceControls: ReadonlySet<string> = new Set(['\t', '\n', '\f', '\r']);

const utf8 = new TextDecoder('utf-8', { fatal: true });

function definitionAt(reference: Schema.Json | undefined, { components }: AnswerSchemas): Schema.Json | undefined {
  if (typeof reference !== 'string' || !reference.startsWith(definitionReference)) {
    return undefined;
  }
  const name = JsonPointer.unescapeToken(reference.slice(definitionReference.length));
  return Object.hasOwn(components, name) ? components[name] : undefined;
}

function applying(schema: Schema.Json | undefined, answers: AnswerSchemas, hops = 0): readonly SchemaObject[] {
  if (!isSchemaObject(schema) || hops > mostReferenceHops) {
    return [];
  }
  const composed = composedSchemas.flatMap((keyword) => {
    const members = schema[keyword];
    return Array.isArray(members) ? members.flatMap((member: Schema.Json) => applying(member, answers, hops + 1)) : [];
  });
  return [schema, ...applying(definitionAt(schema['$ref'], answers), answers, hops + 1), ...composed];
}

function propertySchemaOf(schema: SchemaObject, name: string): Schema.Json | undefined {
  const properties = schema['properties'];
  const additional = schema['additionalProperties'];
  return isSchemaObject(properties) && Object.hasOwn(properties, name) ? properties[name] : additional;
}

function isControl(character: string): boolean {
  return (character < ' ' && !whitespaceControls.has(character)) || character === '\u007F';
}

function textOfBytes(written: string): string | undefined {
  if (written.length % 4 === 1 || !base64Text.test(written)) {
    return undefined;
  }
  try {
    const text = utf8.decode(Buffer.from(written, 'base64'));
    return Array.from(text).some((character) => isControl(character)) ? undefined : text;
  } catch {
    return undefined;
  }
}

function decodedIn(value: unknown, schemas: readonly SchemaObject[], answers: AnswerSchemas): unknown {
  if (schemas.length === 0) {
    return value;
  }
  if (typeof value === 'string') {
    return schemas.some((schema) => schema['format'] === 'byte') ? (textOfBytes(value) ?? value) : value;
  }
  if (Array.isArray(value)) {
    const items = schemas.flatMap((schema) => applying(schema['items'], answers));
    const decoded = value.map((item: unknown) => decodedIn(item, items, answers));
    return decoded.every((item, index) => item === value[index]) ? value : decoded;
  }
  if (!Predicate.isObject(value)) {
    return value;
  }
  const decoded = Object.entries(value).map(
    ([name, item]: readonly [string, unknown]): readonly [string, unknown, unknown] => [
      name,
      item,
      decodedIn(
        item,
        schemas.flatMap((schema) => applying(propertySchemaOf(schema, name), answers)),
        answers,
      ),
    ],
  );
  return decoded.every(([, item, after]) => after === item)
    ? value
    : Object.fromEntries(decoded.map(([name, , after]) => [name, after]));
}

export function decodedAnswer(value: unknown, answers: AnswerSchemas): unknown {
  return decodedIn(
    value,
    answers.schemas.flatMap((schema) => applying(schema, answers)),
    answers,
  );
}
