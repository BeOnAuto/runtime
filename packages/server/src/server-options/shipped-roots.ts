import { apiShippedRoots } from '@on.auto/api';
import { checkShippedRoots } from '@on.auto/definitions/check';
import type { ShippedRoots } from '@on.auto/operations';
import { providersShippedRoots } from '@on.auto/providers';

import { serverShippedRoots } from '../guides/guide-files.ts';

export const shippedRoots: ShippedRoots = {
  ...apiShippedRoots,
  ...checkShippedRoots,
  ...providersShippedRoots,
  ...serverShippedRoots,
};
