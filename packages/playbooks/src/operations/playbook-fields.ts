import { Buffer } from 'node:buffer';

import { PlaybookIdSchema } from '@on.auto/operations';
import { Schema, SchemaTransformation } from 'effect';

export const PlaybookIdField = PlaybookIdSchema.annotate({
  description: 'The id of the playbook: 3 to 48 lowercase letters, digits and hyphens, starting with a letter',
});

export const PlaybookNameField = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100))
  .annotate({
    description: 'The display name of the playbook: 1 to 100 characters, not all whitespace',
  })
  .pipe(
    Schema.decodeTo(Schema.Trimmed.check(Schema.isMinLength(1), Schema.isMaxLength(100)), SchemaTransformation.trim()),
  );

export const PlaybookDescriptionField = Schema.String.check(Schema.isMaxLength(2000))
  .annotate({ description: 'What the playbook is for: up to 2000 characters, or empty' })
  .pipe(Schema.decodeTo(Schema.Trimmed.check(Schema.isMaxLength(2000)), SchemaTransformation.trim()));

const mostPageBytes = 65_536;

export const PlaybookPageField = Schema.NullOr(
  Schema.String.check(
    Schema.makeFilter((page: string) => Buffer.byteLength(page, 'utf8') <= mostPageBytes, {
      expected: `a page of at most ${mostPageBytes} bytes in UTF-8`,
      toJsonSchema: () => [{ maxLength: mostPageBytes }, true],
    }),
  ),
).annotate({
  description: 'Its page as YAML, data and runs, as the page guide says; null removes it',
});
