import { registerHooks } from 'node:module';

import { expect, it } from 'vitest';

const packageName = process.env['PACKAGE_NAME'] ?? '';
const scope = packageName.slice(0, packageName.indexOf('/'));
const aliases = (process.env['PACKAGE_ALIASED_NAMES'] ?? '')
  .split(' ')
  .map((name): readonly [string, string] => [`${scope}/${name}`, `${packageName}/${name}`]);
const subpaths = (process.env['PACKAGE_SUBPATHS'] ?? '').split(' ');

function aliased(specifier: string): string {
  const alias = aliases.find(
    ([name]: readonly [string, string]) => specifier === name || specifier.startsWith(`${name}/`),
  );
  return alias === undefined ? specifier : `${alias[1]}${specifier.slice(alias[0].length)}`;
}

registerHooks({
  resolve: (specifier: string, context: Readonly<{ parentURL: string | undefined }>, nextResolve) =>
    nextResolve(aliased(specifier), context),
});

function failuresOf(imported: readonly string[], outcomes: readonly Readonly<PromiseSettledResult<unknown>>[]) {
  return outcomes.flatMap((outcome: Readonly<PromiseSettledResult<unknown>>, index) =>
    outcome.status === 'rejected' ? [`${imported[index] ?? ''}: ${String(outcome.reason)}`] : [],
  );
}

const failures = failuresOf(
  subpaths,
  await Promise.allSettled(subpaths.map((subpath): Promise<unknown> => import(subpath))),
);

const { importedWithoutAnAddress } = await import('@on.auto/operations/testing');

const besideTests = subpaths.filter((subpath) => !subpath.endsWith('/testing'));

const failuresWithoutAnAddress = failuresOf(
  besideTests,
  await Promise.allSettled(
    besideTests.map((subpath) => importedWithoutAnAddress(new URL(import.meta.resolve(subpath)))),
  ),
);

it('imports every subpath of the package, the names of its packages aliased to them', () => {
  expect(failures).toEqual([]);
});

it('imports every subpath but the testing ones where import.meta.url names no file, so none makes a URL of it as it loads', () => {
  expect([besideTests.length > 0, failuresWithoutAnAddress]).toEqual([true, []]);
});
