import type { AppRuntime } from '@on.auto/api';
import { toolImagesKept, type KeepToolImage } from '@on.auto/generation';
import type { DispatcherServices } from '@on.auto/operations';

import type { Settings } from '../settings/settings.ts';
import { runtimeLedger } from './runtime-ledger.ts';

interface KeptByRuns {
  readonly content: ReturnType<typeof runtimeLedger>['content'];
  readonly images: KeepToolImage;
}

export function keptByRuns(
  runtime: AppRuntime<DispatcherServices>,
  { generation }: Pick<Settings, 'generation'>,
): KeptByRuns {
  const ledger = runtimeLedger(runtime);
  return { content: ledger.content, images: toolImagesKept({ ledger, content: ledger.content, bounds: generation }) };
}
