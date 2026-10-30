import { Option, Result, Schema } from 'effect';

import { readJsonSetting, type Environment } from '../settings/json-setting.ts';
import { ApiKeySchema, type ApiKey } from './api-key.ts';
import { InvalidApiKeysError } from './invalid-api-keys-error.ts';

const distinctIds = Schema.makeFilter(
  (keys: readonly ApiKey[]) => new Set(keys.map(({ id }) => id)).size === keys.length || 'Key ids must be unique',
);

export const apiKeysVariable = 'API_KEYS';

export const ApiKeysSchema = Schema.Array(ApiKeySchema).check(distinctIds);

const decodeApiKeys = Schema.decodeUnknownResult(Schema.fromJsonString(ApiKeysSchema), {
  onExcessProperty: 'error',
  errors: 'all',
});

export function readApiKeys(environment: Environment): readonly ApiKey[] | undefined {
  const read = readJsonSetting(environment, apiKeysVariable, decodeApiKeys);
  if (Result.isFailure(read)) {
    throw new InvalidApiKeysError({ message: read.failure });
  }
  return Option.getOrUndefined(read.success);
}
