import type { AssetHolding } from '@on.auto/operations';
import { capitalized } from '@on.auto/phrasing';
import { Effect, Result } from 'effect';

import { mostRequestBytesTo } from '../bounds/call-bounds.ts';
import type { ToolReference } from '../names/tool-reference.ts';
import { toolInWords } from '../names/tool-words.ts';
import { plannedAssets, type AssetsNotSent, type SentAsset } from '../sent-assets/planned-assets.ts';
import type { Opened } from './call-opening.ts';
import type { ActingMark, AssetNotSentOnce, NotReadOnlyOnce, UnopenedOnce } from './called-once.ts';

export interface AdmittedCall {
  readonly org: string;
  readonly playbook: string;
  readonly reference: ToolReference;
  readonly input: Readonly<Record<string, unknown>>;
  readonly requiredMark?: 'reads';
}

export interface Admitting {
  readonly assets: AssetHolding;
  readonly mostRequestBytes: number;
  readonly awaited: <A>(effect: Effect.Effect<A>) => Promise<A>;
}

const markInWords: Readonly<Record<ActingMark, string>> = {
  acts: 'is marked acts',
  unmarked: 'carries no mark, which counts as acts',
};

function notReadOnlyOnce(reference: ToolReference, mark: ActingMark): NotReadOnlyOnce {
  return {
    kind: 'unopened',
    refused: 'tool_not_read_only',
    mark,
    detail: `${capitalized(toolInWords(reference))} ${markInWords[mark]}, and the call needs one marked reads, so it was not sent`,
  };
}

function assetNotSentOnce({ because, pointer, detail }: AssetsNotSent): AssetNotSentOnce {
  return { kind: 'unopened', refused: 'asset_not_sent', because, pointer, detail };
}

async function assetsOf(call: AdmittedCall, { slot, tool }: Opened, admitting: Admitting) {
  const planned = await admitting.awaited(
    Effect.result(
      plannedAssets(call.input, {
        holding: admitting.assets,
        playbook: { org: call.org, playbook: call.playbook },
        inputSchema: tool.inputSchema,
        tool: toolInWords(call.reference),
        mostBytes: mostRequestBytesTo(slot.settings, admitting.mostRequestBytes),
      }),
    ),
  );
  return Result.isSuccess(planned) ? planned.success.sent : assetNotSentOnce(planned.failure);
}

export function admittedOnce(
  call: AdmittedCall,
  opened: Opened,
  admitting: Admitting,
): Promise<readonly SentAsset[] | UnopenedOnce> {
  const { mark } = opened.tool;
  return call.requiredMark === 'reads' && mark !== 'reads'
    ? Promise.resolve(notReadOnlyOnce(call.reference, mark))
    : assetsOf(call, opened, admitting);
}
