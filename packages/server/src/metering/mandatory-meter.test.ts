import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { configFileSchemaPath } from '../config-file/config-file-schema.ts';
import { variablesTheRuntimeReads } from '../connections/variables-the-runtime-reads.ts';

describe('the meter of the runtime', () => {
  it('has no environment variable or configuration key that could turn it off', () => {
    const named = /\bmeter(?:s|ed|ing)?\b/iu;

    expect(variablesTheRuntimeReads.filter((variable) => named.test(variable))).toEqual([]);
    expect(named.test(readFileSync(configFileSchemaPath, 'utf8'))).toBe(false);
  });
});
