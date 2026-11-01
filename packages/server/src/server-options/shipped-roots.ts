import { apiShippedRoots } from '@on.auto/api';
import { checkShippedRoots } from '@on.auto/definitions/check';
import { providersShippedRoots } from '@on.auto/providers';
import type { ShippedRoots } from '@on.auto/shipped-files';

export const shippedRoots: ShippedRoots = {
  ...apiShippedRoots(),
  ...checkShippedRoots(),
  ...providersShippedRoots(),
};
