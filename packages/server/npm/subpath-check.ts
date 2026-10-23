import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

import { linked } from '../src/command-line/launch.ts';

export interface SubpathCheck {
  readonly packageName: string;
  readonly tarball: string;
  readonly modules: ReadonlyMap<string, string>;
  readonly aliasedNames: readonly string[];
  readonly subpaths: readonly string[];
}

export function importedSubpaths({ packageName, tarball, modules, aliasedNames, subpaths }: SubpathCheck): void {
  const program = mkdtempSync(join(tmpdir(), 'auto-runtime-program-'));
  try {
    execFileSync('tar', ['-xzf', tarball, '-C', program]);
    linked(program, new Map([...modules, [packageName, join(program, 'package')]]));
    cpSync(fileURLToPath(new URL('subpath-imports.ts', import.meta.url)), join(program, 'subpath-imports.test.ts'));
    execFileSync(
      process.execPath,
      [
        join(program, 'node_modules', 'vitest', 'vitest.mjs'),
        'run',
        '--root',
        program,
        '--experimental.viteModuleRunner=false',
        'subpath-imports.test.ts',
      ],
      {
        cwd: program,
        stdio: 'inherit',
        env: {
          ...process.env,
          PACKAGE_NAME: packageName,
          PACKAGE_ALIASED_NAMES: aliasedNames.join(' '),
          PACKAGE_SUBPATHS: subpaths.map((subpath) => posix.join(packageName, subpath)).join(' '),
        },
      },
    );
  } finally {
    rmSync(program, { recursive: true, force: true });
  }
}
