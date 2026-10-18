import { utf8Bytes, type SchemaIssue } from '@on.auto/json-schema';
import type { Schema } from 'effect';

import { shapeOf, type OutputShape } from './output-shape.ts';
import { counted, issueAt, recordOf, textValue } from './shape-values.ts';

export const textBounds = { mostBytes: 65_536 } as const;

function textIssues(value: Schema.Json): readonly SchemaIssue[] {
  const text = textValue(recordOf(value)['text']);
  return text !== undefined && utf8Bytes(text) > textBounds.mostBytes
    ? [issueAt(['text'], `Expected at most ${counted.format(textBounds.mostBytes)} bytes as UTF-8`)]
    : [];
}

export const textShape: OutputShape = shapeOf({
  name: 'text',
  properties: {
    text: { type: 'string', maxLength: textBounds.mostBytes, description: 'Markdown' },
  },
  required: ['text'],
  further: textIssues,
});
