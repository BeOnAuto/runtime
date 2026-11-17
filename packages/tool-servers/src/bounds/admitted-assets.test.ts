import { describe, expect, it } from 'vitest';

import { actingCallsCount, admission, modelSendsNoAsset, noCalls, type CallAsked } from './call-bounds.ts';

type Input = Readonly<Record<string, unknown>>;

function asked(callId: string, input: Input): CallAsked {
  return { tool: 'files__save', callId, input, reads: false, mostBytes: 1_048_576 };
}

const asset = {
  id: '019a5b12-0000-7000-8000-000000000001',
  media_type: 'application/pdf',
  bytes: 3_355_443,
  sha256: 'a'.repeat(64),
  address: null,
  address_until: null,
};

describe('admitting a call that names an asset', () => {
  it('refuses one a model wrote, wherever the asset is in its arguments, and counts it as refused', () => {
    const inputs: readonly Input[] = [{ file: asset }, { attachments: [{ name: 'report.pdf', file: asset }] }];
    const refused = inputs.map((input: Input, index) =>
      admission(noCalls, asked(`call-${index}`, input), actingCallsCount),
    );

    expect(refused).toEqual([
      { admitted: false, tally: noCalls, refusal: modelSendsNoAsset },
      { admitted: false, tally: noCalls, refusal: modelSendsNoAsset },
    ]);
    expect(modelSendsNoAsset).toBe(
      'A call a model writes sends no asset; pass the asset to an interaction function, whose call sends it.',
    );
  });

  it('admits one whose assets its caller planned, as a call made by hand is, and an object that only looks like one', () => {
    const planned: CallAsked = { ...asked('call-1', { file: asset }), assetsPlanned: true };
    const { address: _address, ...partly } = asset;

    expect([
      admission(noCalls, planned, actingCallsCount).admitted,
      admission(noCalls, asked('call-2', { file: partly }), actingCallsCount).admitted,
    ]).toEqual([true, true]);
  });
});
