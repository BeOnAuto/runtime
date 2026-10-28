import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { scriptedRuntime } from '../runtime-testing/scripted-runtime.ts';
import { scratchDirectory } from '../testing/scratch.ts';
import { importedFitters, importedRuntime } from './runtime-modules.ts';

function moduleOf(name: string, source: string): string {
  const module = join(scratchDirectory(), name);
  writeFileSync(module, source);
  return pathToFileURL(module).href;
}

describe('the module of a model runtime a model process imports', () => {
  it('gives the loader of its models, and fails, so that its process is let go, when it exports none', async () => {
    const module = moduleOf('no-loader.mjs', 'export const nothing = 1;\n');

    expect(typeof (await importedRuntime(scriptedRuntime.binding.module().href))).toBe('function');
    await expect(importedRuntime(module)).rejects.toThrow(
      `The module ${module} of a model runtime exports no loadModel`,
    );
  });

  it('gives the models its runtime fits itself and its default model, and fails when it exports either alone or neither', async () => {
    const neither = moduleOf('no-fitters.mjs', 'export const loadModel = () => null;\n');
    const fitsAlone = moduleOf('fits-alone.mjs', 'export const fitModels = () => [];\n');
    const refusal = 'of a model runtime that fits its own models exports no fitModels and defaultModel';

    expect(Object.keys(await importedFitters(scriptedRuntime.binding.module().href))).toEqual([
      'fitModels',
      'defaultModel',
    ]);
    await expect(importedFitters(neither)).rejects.toThrow(refusal);
    await expect(importedFitters(fitsAlone)).rejects.toThrow(refusal);
  });
});
