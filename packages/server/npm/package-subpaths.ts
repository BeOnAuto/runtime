import { posix } from 'node:path';

export interface PackedPackage {
  readonly name: string;
  readonly directory: string;
  readonly exports: Readonly<Record<string, string>>;
}

export const aliasPlace = '<!-- npm/pack.ts writes the alias here -->';

function scopeOf(name: string): string {
  return name.slice(0, name.indexOf('/'));
}

function nameInScope(name: string): string {
  return name.slice(name.indexOf('/') + 1);
}

export function subpathsOf(packed: readonly PackedPackage[]): Readonly<Record<string, string>> {
  return Object.fromEntries(
    packed.flatMap(({ name, directory, exports }: PackedPackage) =>
      Object.entries(exports).map(([entry, target]: readonly [string, string]) => [
        `./${posix.join(nameInScope(name), entry)}`,
        `./${posix.join(directory, target)}`,
      ]),
    ),
  );
}

export function aliasedNamesOf(packed: readonly PackedPackage[]): readonly string[] {
  return packed
    .filter(({ exports }: PackedPackage) => Object.keys(exports).length > 0)
    .map(({ name }) => nameInScope(name));
}

export function readmeWithAlias(readme: string, root: string, names: readonly string[]): string {
  const around = readme.split(aliasPlace);
  if (around.length !== 2) {
    throw new Error(`The README must hold ${aliasPlace} once`);
  }
  return around.join(
    [
      '```js',
      `const names = [${names.map((name) => `'${name}'`).join(', ')}];`,
      `const alias = Object.fromEntries(names.map((name) => [\`${scopeOf(root)}/\${name}\`, \`${root}/\${name}\`]));`,
      '```',
    ].join('\n'),
  );
}
