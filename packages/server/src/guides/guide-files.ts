import type { ShippedFile, ShippedRoots } from '@on.auto/operations';

const serverPackage = '@on.auto/server';

const runtimePackage = '@on.auto/runtime';

export const serverShippedRoots: ShippedRoots = {
  [serverPackage]: new URL('../../', import.meta.url),
  [runtimePackage]: new URL('../../../../', import.meta.url),
};

export const recipesFolder: ShippedFile = { package: serverPackage, path: 'src/guides/recipes' };

export const documentation: ShippedFile = { package: runtimePackage, path: 'docs' };
