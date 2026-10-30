import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { localDevelopment } from './local-development.ts';

const repository = fileURLToPath(new URL('../../../..', import.meta.url));

describe('the local development setup', () => {
  it('runs src/main.ts with dev.env, then the repository .env, and auto-runtime.yaml at the root', () => {
    expect(localDevelopment()).toMatchObject({
      envFiles: [join(repository, 'packages/server/dev.env'), join(repository, '.env')],
      serverEntry: join(repository, 'packages/server/src/main.ts'),
      configFile: join(repository, 'auto-runtime.yaml'),
    });
  });

  it('watches the source directory of every workspace package', () => {
    const watched = localDevelopment().sourceDirectories;

    const missing = [
      'packages/server',
      'packages/api',
      'packages/workflow-host',
      'capabilities/coordination',
      'capabilities/reasoning',
    ]
      .map((workspace) => join(repository, workspace, 'src'))
      .filter((directory) => !watched.includes(directory));

    expect(missing).toEqual([]);
  });
});
