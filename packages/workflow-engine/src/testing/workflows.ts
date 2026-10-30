import { Schema } from 'effect';
import { parse } from 'yaml';

import type { JsonObject } from '../dsl/json.ts';

export const header = { dsl: '1.0.3', namespace: 'acme', name: 'test', version: '1.0.0' };

const decodeObject = Schema.decodeUnknownSync(Schema.JsonObject);

export function yamlObject(source: string): JsonObject {
  return decodeObject(parse(source));
}

export function workflow(source: string): JsonObject {
  return { document: header, ...yamlObject(source) };
}
