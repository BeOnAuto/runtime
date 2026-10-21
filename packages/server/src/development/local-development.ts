import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { restartMarkIn } from '../local-runtime/runtime-restarts.ts';
import { startChild } from './children.ts';
import type { DevelopmentSetup } from './development-run.ts';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));

function workspaceSources(root: string): readonly string[] {
  return ['packages', 'capabilities']
    .flatMap((group) => readdirSync(join(root, group)).map((name) => join(root, group, name, 'src')))
    .filter((directory) => existsSync(directory));
}

export function localDevelopment(): DevelopmentSetup {
  return {
    envFiles: [join(repository, 'packages', 'server', 'dev.env'), join(repository, '.env')],
    sourceDirectories: workspaceSources(repository),
    serverEntry: join(repository, 'packages', 'server', 'src', 'main.ts'),
    configFile: join(repository, 'auto-runtime.yaml'),
    startChild,
    restartMark: restartMarkIn(homedir()),
  };
}
