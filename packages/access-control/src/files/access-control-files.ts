import { dependencyFileOf, type ShippedFile, type ShippedRoots } from '@on.auto/shipped-files';

const accessControlPackage = '@on.auto/access-control';

export function accessControlShippedRoots(): ShippedRoots {
  return { [accessControlPackage]: new URL('../../', import.meta.url) };
}

export const accessSchemaFile: ShippedFile = { package: accessControlPackage, path: 'src/policies/access.cedarschema' };

export const builtInPoliciesFile: ShippedFile = { package: accessControlPackage, path: 'src/policies/built-in.cedar' };

export const cedarNoticeFiles: readonly ShippedFile[] = [
  { package: accessControlPackage, path: 'src/engine/Cedar-LICENSE.txt' },
  { package: accessControlPackage, path: 'src/engine/Cedar-NOTICE.txt' },
  { package: accessControlPackage, path: 'src/engine/Cedar-THIRD-PARTY-NOTICES.txt' },
];

export const cedarModuleFile: ShippedFile = dependencyFileOf(
  accessControlPackage,
  '@cedar-policy/cedar-wasm',
  'web/cedar_wasm_bg.wasm',
);
