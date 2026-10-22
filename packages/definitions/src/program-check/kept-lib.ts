import type { CheckHandler, HandedFile } from '@on.auto/workflow-engine/job-loop';

import { checkerOf } from './checking.ts';
import type { SandboxLib } from './sandbox-lib.ts';

export const keptLibFiles: Readonly<Record<keyof SandboxLib, URL>> = {
  script: new URL('../../lib/sandbox.d.ts.txt', import.meta.url),
  iterator: new URL('../../lib/sandbox-iterator.d.ts.txt', import.meta.url),
};

export function sandboxLibFrom(handed: HandedFile): SandboxLib {
  const decoder = new TextDecoder();
  return {
    script: decoder.decode(handed(keptLibFiles.script)),
    iterator: decoder.decode(handed(keptLibFiles.iterator)),
  };
}

export function handedChecks(handed: HandedFile): { readonly check: CheckHandler } {
  return { check: checkerOf(sandboxLibFrom(handed)) };
}
