import { fileURLToPath } from 'node:url';

import { Schema } from 'effect';

import { fileSettings } from './file-settings.ts';

export const configFileSchemaPath = fileURLToPath(new URL('../../../../auto-runtime.schema.json', import.meta.url));

function configFileJsonSchema(): Readonly<Record<string, unknown>> {
  const fields = Object.fromEntries(fileSettings.map(({ key, schema }) => [key, Schema.optionalKey(schema)]));
  const { schema, definitions } = Schema.toJsonSchemaDocument(Schema.Struct(fields), { onExcessProperty: 'error' });
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Auto Runtime configuration file',
    description:
      'The settings of Auto Runtime that are lists or maps, and where Studio comes from, read from the file that CONFIG_FILE names. Each key stands for the environment variable of the same name in upper case, which wins over it. Secrets are written as references such as ${GATEWAY_API_KEY}.',
    ...schema,
    $defs: definitions,
  };
}

export function configFileSchemaText(): string {
  return `${JSON.stringify(configFileJsonSchema(), null, 2)}\n`;
}
