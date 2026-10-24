import type { ShippedFile, ShippedRoots } from '@on.auto/operations';
import type { HandedFile } from '@on.auto/workflow-engine/job-loop';

import type { SandboxLib } from './sandbox-lib.ts';

export const definitionsPackage = '@on.auto/definitions';

export const definitionsShippedRoots: ShippedRoots = { [definitionsPackage]: new URL('../../', import.meta.url) };

export const keptLibFiles: Readonly<Record<keyof SandboxLib, ShippedFile>> = {
  script: { package: definitionsPackage, path: 'lib/sandbox.d.ts.txt' },
  iterator: { package: definitionsPackage, path: 'lib/sandbox-iterator.d.ts.txt' },
};

export function sandboxLibFrom(handed: HandedFile): SandboxLib {
  const decoder = new TextDecoder();
  return {
    script: decoder.decode(handed(keptLibFiles.script)),
    iterator: decoder.decode(handed(keptLibFiles.iterator)),
  };
}
