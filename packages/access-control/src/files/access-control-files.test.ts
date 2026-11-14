import { sha256Of } from '@on.auto/content';
import { describe, expect, it } from 'vitest';

import { filesOnDisk } from '../testing/access-testing.ts';
import {
  accessControlShippedRoots,
  accessSchemaFile,
  builtInPoliciesFile,
  cedarModuleFile,
  cedarNoticeFiles,
} from './access-control-files.ts';

describe('the files the access control ships', () => {
  it('are named under the package, its root read only when it is asked for', () => {
    expect(Object.keys(accessControlShippedRoots())).toEqual(['@on.auto/access-control']);
    expect(accessControlShippedRoots()['@on.auto/access-control']?.href).toBe(new URL('../../', import.meta.url).href);
  });

  it('are the schema and the built-in policies beside its code, and the engine in the folder of the package that ships it', async () => {
    expect(await filesOnDisk.text(accessSchemaFile)).toContain('entity Org;');
    expect(await filesOnDisk.text(builtInPoliciesFile)).toContain('@id("viewer")');
    expect(cedarModuleFile).toEqual({
      package: '@on.auto/access-control',
      path: 'node_modules/@cedar-policy/cedar-wasm/web/cedar_wasm_bg.wasm',
    });
    expect([...(await filesOnDisk.bytes(cedarModuleFile)).subarray(0, 4)]).toEqual([0, 97, 115, 109]);
  });

  it("carry Cedar's own LICENSE and NOTICE, byte for byte as its repository holds them at the tag v4.14.0, and the notices of the crates compiled into its WebAssembly as the script of the repository wrote them", async () => {
    const texts = await Promise.all(cedarNoticeFiles.map((file) => filesOnDisk.bytes(file)));

    expect(cedarNoticeFiles.map(({ path }) => path)).toEqual([
      'src/engine/Cedar-LICENSE.txt',
      'src/engine/Cedar-NOTICE.txt',
      'src/engine/Cedar-THIRD-PARTY-NOTICES.txt',
    ]);
    expect(texts.map((text: Readonly<Uint8Array>) => sha256Of(text))).toEqual([
      '09e8a9bcec8067104652c168685ab0931e7868f9c8284b66f5ae6edae5f1130b',
      '03844ca1749f2008269484548dd96557d19998145eba62c6e2f1a9e5dfa9e0a4',
      '776148be9454aebbf8d18667b1e4a3333a50cc32de13edf99931751427f7bc36',
    ]);
  });
});
