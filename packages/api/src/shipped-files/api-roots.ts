import type { ShippedRoots } from '@on.auto/operations';

export const apiPackage = '@on.auto/api';

export const runtimePackage = '@on.auto/runtime';

export const apiShippedRoots: ShippedRoots = {
  [apiPackage]: new URL('../../', import.meta.url),
  [runtimePackage]: new URL('../../../../', import.meta.url),
};
