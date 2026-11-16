import { existsSync, readdirSync, readFileSync, type Dirent } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

const [modules] = process.argv.slice(2);
if (modules === undefined) throw new Error('The node_modules folder the packed package was installed into is required');

const scriptsThatBuildOnInstall: readonly string[] = ['preinstall', 'install'];

function isAPackageFolder(folder: string): boolean {
  const parent = dirname(folder);
  return (
    basename(parent) === 'node_modules' ||
    (basename(parent).startsWith('@') && basename(dirname(parent)) === 'node_modules')
  );
}

function scriptsOf(manifest: string): Readonly<Record<string, unknown>> {
  const read: unknown = JSON.parse(readFileSync(manifest, 'utf8'));
  if (typeof read !== 'object' || read === null || !('scripts' in read)) return {};
  const { scripts } = read;
  return typeof scripts === 'object' && scripts !== null ? Object.fromEntries(Object.entries(scripts)) : {};
}

function buildsOnInstall(folder: string): readonly string[] {
  const scripts = scriptsOf(join(folder, 'package.json'));
  return [
    ...scriptsThatBuildOnInstall
      .filter((name) => name in scripts)
      .map((name) => `its ${name} script runs ${String(scripts[name])}`),
    ...(existsSync(join(folder, 'binding.gyp')) ? ['it holds a binding.gyp, which npm compiles with node-gyp'] : []),
  ];
}

function foundIn(installed: string, entry: Readonly<Dirent>): readonly string[] {
  if (entry.name.endsWith('.node'))
    return [`${relative(installed, join(entry.parentPath, entry.name))} is a native add-on`];
  if (entry.name === 'package.json' && isAPackageFolder(entry.parentPath)) {
    return buildsOnInstall(entry.parentPath).map((why) => `${relative(installed, entry.parentPath)}: ${why}`);
  }
  return [];
}

const found = readdirSync(modules, { recursive: true, withFileTypes: true })
  .filter((entry: Readonly<Dirent>) => entry.isFile())
  .flatMap((entry: Readonly<Dirent>) => foundIn(modules, entry));

if (found.length > 0) {
  process.stderr.write(`The packed package installs a native add-on, or a package that builds one as it installs:\n`);
  for (const line of found) process.stderr.write(`  ${line}\n`);
  process.exit(1);
}
process.stdout.write(`The packed package installs no native add-on and no package that builds one as it installs\n`);
