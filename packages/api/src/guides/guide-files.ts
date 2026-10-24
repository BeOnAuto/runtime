import type { ShippedFile } from '@on.auto/operations';

import { apiPackage, runtimePackage } from '../shipped-files/api-roots.ts';

export const recipesFolder: ShippedFile = { package: apiPackage, path: 'src/guides/recipes' };

export const documentation: ShippedFile = { package: runtimePackage, path: 'docs' };
