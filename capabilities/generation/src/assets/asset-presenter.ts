import { changingEvents, type PresentedFact, type Presenter } from '@on.auto/operations';
import { sizeInWords } from '@on.auto/phrasing';
import { Schema } from 'effect';

import { AssetEventSchema, assetsKind, type AssetEvent, type AssetMadeBy } from './asset-facts.ts';
import { dayOf, kindInWords } from './asset-words.ts';

const decodeAssetEvent = Schema.decodeUnknownSync(Schema.toCodecJson(AssetEventSchema));

function placeInWords(pointer: string): string {
  return pointer === '' ? 'as its output' : `at ${pointer} of its output`;
}

function makerInWords(madeBy: AssetMadeBy): string {
  if ('tool_call' in madeBy) {
    return `the ${madeBy.tool_call.tool} tool of ${madeBy.tool_call.server} answered`;
  }
  return 'function_output' in madeBy
    ? `a run returned ${placeInWords(madeBy.function_output.pointer)}`
    : 'a generation function made';
}

function presentedFactOf(event: AssetEvent): PresentedFact {
  if (event.type === 'asset_kept') {
    const { data } = event;
    return {
      type: event.type,
      summary: `The playbook kept ${kindInWords[data.kind]} of ${sizeInWords(data.bytes)} that ${makerInWords(data.made_by)}, until ${dayOf(data.expires_at)}.`,
      data,
    };
  }
  if (event.type === 'asset_content_removed') {
    const { data } = event;
    return {
      type: event.type,
      summary: `The content of an expired asset, ${sizeInWords(data.bytes)}, was removed, since nothing else of the playbook holds it.`,
      data,
    };
  }
  const { data } = event;
  return {
    type: event.type,
    summary: `An asset of ${sizeInWords(data.bytes)} expired.`,
    data,
  };
}

export const assetPresenter: Presenter = {
  streamKind: assetsKind,
  publicNames: {
    asset_kept: ['asset_kept'],
    asset_expired: ['asset_expired'],
    asset_content_removed: ['asset_content_removed'],
  },
  present: ({ type, data, context }) => [presentedFactOf(decodeAssetEvent({ type, data, context }))],
  changes: changingEvents(['asset_kept', 'asset_expired', 'asset_content_removed']),
};
