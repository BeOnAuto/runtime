import type { CheckHandler, HandedFile } from '@on.auto/workflow-engine/job-loop';

import { checkerOf } from './checking.ts';
import { sandboxLibFrom } from './kept-lib.ts';

export function handedChecks(handed: HandedFile): { readonly check: CheckHandler } {
  return { check: checkerOf(sandboxLibFrom(handed)) };
}
