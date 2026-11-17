import type { AppRuntime } from '@on.auto/api';
import { assetsHeld, toolImagesKept, type KeepToolImage } from '@on.auto/generation';
import type { AssetHolding, DispatcherServices } from '@on.auto/operations';

import type { Settings } from '../settings/settings.ts';
import { runtimeLedger } from './runtime-ledger.ts';

interface KeptByRuns {
  readonly content: ReturnType<typeof runtimeLedger>['content'];
  readonly images: KeepToolImage;
}

interface HeldForCalls {
  readonly content: ReturnType<typeof runtimeLedger>['content'];
  readonly assets: AssetHolding;
}

export function heldForCalls(runtime: AppRuntime<DispatcherServices>): HeldForCalls {
  const ledger = runtimeLedger(runtime);
  return { content: ledger.content, assets: assetsHeld({ ledger, content: ledger.content }) };
}

export function keptByRuns(
  runtime: AppRuntime<DispatcherServices>,
  { generation }: Pick<Settings, 'generation'>,
): KeptByRuns {
  const ledger = runtimeLedger(runtime);
  return { content: ledger.content, images: toolImagesKept({ ledger, content: ledger.content, bounds: generation }) };
}
