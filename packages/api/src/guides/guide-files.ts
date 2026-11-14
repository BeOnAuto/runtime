import type { ShippedFile } from '@on.auto/shipped-files';

import { apiPackage, runtimePackage } from '../shipped-files/api-roots.ts';

export const recipesFolder: ShippedFile = { package: apiPackage, path: 'src/guides/recipes' };

export const goalsGuideFile: ShippedFile = { package: apiPackage, path: 'src/guides/goals/goals.md' };

export const documentation: ShippedFile = { package: runtimePackage, path: 'docs' };
