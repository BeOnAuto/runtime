import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { scriptedRuntime } from '../runtime-testing/scripted-runtime.ts';
import { scratchDirectory } from '../testing/scratch.ts';
import { importedRuntime } from './runtime-modules.ts';

describe('the module of a model runtime a model process imports', () => {
  it('gives the loader of its models, and fails, so that its process is let go, when it exports none', async () => {
    const module = join(scratchDirectory(), 'no-loader.mjs');
    writeFileSync(module, 'export const nothing = 1;\n');

    expect(typeof (await importedRuntime(scriptedRuntime.binding.module().href))).toBe('function');
    await expect(importedRuntime(pathToFileURL(module).href)).rejects.toThrow(
      `The module ${pathToFileURL(module).href} of a model runtime exports no loadModel`,
    );
  });
});
