import { changingEvents, type PresentedFact, type Presenter } from '@on.auto/operations';
import { Schema } from 'effect';

import { AssetEventSchema, assetsKind, type AssetEvent } from './asset-facts.ts';
import { dayOf, kindInWords, sizeInWords } from './asset-words.ts';

const decodeAssetEvent = Schema.decodeUnknownSync(Schema.toCodecJson(AssetEventSchema));

function presentedFactOf(event: AssetEvent): PresentedFact {
  if (event.type === 'asset_kept') {
    const { data } = event;
    return {
      type: event.type,
      summary: `The playbook kept ${kindInWords[data.kind]} of ${sizeInWords(data.bytes)} that a generation function made, until ${dayOf(data.expires_at)}.`,
      data,
    };
  }
  const { data } = event;
  return {
    type: event.type,
    summary: data.content_removed
      ? `An asset of ${sizeInWords(data.bytes)} expired, and its content was removed.`
      : `An asset of ${sizeInWords(data.bytes)} expired, and its content was kept.`,
    data,
  };
}

export const assetPresenter: Presenter = {
  streamKind: assetsKind,
  publicNames: { asset_kept: ['asset_kept'], asset_expired: ['asset_expired'] },
  present: ({ type, data, context }) => [presentedFactOf(decodeAssetEvent({ type, data, context }))],
  changes: changingEvents(['asset_kept', 'asset_expired']),
};
