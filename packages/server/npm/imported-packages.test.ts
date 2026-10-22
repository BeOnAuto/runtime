import { describe, expect, it } from 'vitest';

import { bareSpecifiersIn } from './imported-packages.ts';

describe('the packages a shipped source imports', () => {
  it('are read from its import and export statements, its side-effect imports, and its dynamic imports and resolves', () => {
    const source = [
      "import { Effect } from 'effect';",
      'import {',
      '  defineCapability,',
      '  outputInWords,',
      "} from '@on.auto/definitions';",
      "import * as path from 'node:path';",
      "export { templateEngine } from '@on.auto/definitions/template';",
      "export * from './local.ts';",
      "import './register.ts';",
      "import 'reflect-metadata';",
      "const loaded = await import('liquidjs');",
      "const worker = import.meta.resolve('@on.auto/workflow-engine/job-loop');",
    ].join('\n');

    expect(bareSpecifiersIn(source)).toEqual([
      'effect',
      '@on.auto/definitions',
      'node:path',
      '@on.auto/definitions/template',
      'reflect-metadata',
      'liquidjs',
      '@on.auto/workflow-engine/job-loop',
    ]);
  });

  it('are never the words of a string, such as one that holds from or import followed by a quote', () => {
    const source = [
      'const bounds = [',
      "  { low: 'minimum', high: 'maximum', from: 'from ' },",
      "  { low: 'minLength', high: 'maxLength', from: '' },",
      '];',
      "const said = 'import ';",
      "  export const indented = 'from ' + 'nowhere';",
    ].join('\n');

    expect(bareSpecifiersIn(source)).toEqual([]);
  });
});
