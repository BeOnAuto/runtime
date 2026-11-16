import { readFileSync } from 'node:fs';

import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { configFileSchemaPath } from '../../config-file/config-file-schema.ts';
import { variablesTheRuntimeReads } from '../../connections/variables-the-runtime-reads.ts';
import { settingNames } from './setting-names.ts';

const decodedSchema = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ properties: Schema.Record(Schema.String, Schema.Unknown) })),
);

function keysOfTheConfigurationFile(): readonly string[] {
  return Object.keys(decodedSchema(readFileSync(configFileSchemaPath, 'utf8')).properties);
}

describe('the names of the settings the server declares', () => {
  it('are every variable the runtime reads and every key of its configuration file, each once', () => {
    expect(settingNames.toSorted()).toEqual(
      [...new Set([...variablesTheRuntimeReads, ...keysOfTheConfigurationFile()])].toSorted(),
    );
    expect(settingNames).toEqual(expect.arrayContaining(['MODEL_GATEWAYS', 'model_gateways', 'PORT', 'license']));
  });
});
