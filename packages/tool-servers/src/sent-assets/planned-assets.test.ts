import { Buffer } from 'node:buffer';

import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { heldForATest, keptForATest, type KeptForATest } from '../testing/held-assets.ts';
import { mostDepthOfAValue, plannedAssets, type AssetPlanning, type AssetsNotSent } from './planned-assets.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const inputSchema = {
  type: 'object',
  properties: {
    content: { type: 'string' },
    file: { type: 'string', format: 'byte' },
    rows: { type: 'array' },
  },
};

const page = keptForATest('asset-page', 'text/plain', 'Ünïcode\n');

const photo = keptForATest('asset-photo', 'image/png', Uint8Array.of(137, 80, 78, 71));

const broken = keptForATest('asset-broken', 'application/json', '[1, 2');

const deep = keptForATest(
  'asset-deep',
  'application/json',
  `${'['.repeat(mostDepthOfAValue + 1)}${']'.repeat(mostDepthOfAValue + 1)}`,
);

const notUtf8 = keptForATest('asset-bytes', 'application/json', Uint8Array.of(0x5b, 0xff, 0x5d));

const gone: KeptForATest = { ...keptForATest('asset-gone', 'text/plain', 'gone'), removed: true };

function planned(input: Readonly<Record<string, unknown>>, changes: Partial<AssetPlanning> = {}) {
  return Effect.runPromise(
    Effect.result(
      plannedAssets(input, {
        holding: heldForATest([page, photo, broken, deep, notUtf8, gone]),
        playbook: alpha,
        inputSchema,
        tool: 'the save tool of files',
        mostBytes: 1_048_576,
        ...changes,
      }),
    ),
  );
}

async function refusalOf(input: Readonly<Record<string, unknown>>): Promise<AssetsNotSent> {
  return Result.getOrThrow(Result.flip(await planned(input)));
}

const notJsonWords = [
  'The argument /rows is an asset of application/json that holds no JSON value, so it is not sent as one; send it where the save tool of files takes a string, not an object or array',
  'The argument /rows is an asset of application/json whose JSON nests deeper than the 512 levels a value may, so it is not sent as one; send it where the save tool of files takes a string, not an object or array',
  "The argument /rows is an asset of application/json that is not UTF-8 text, so it is not sent as a JSON value; send it as a file, where a tool's schema says format: byte or contentEncoding: base64",
];

describe('the assets a call’s arguments hold, planned before the call is recorded', () => {
  it('are none for arguments that hold none, and the request takes the bytes of their JSON', async () => {
    expect(await planned({ content: 'plain' })).toMatchObject({ success: { sent: [], requestBytes: 19 } });
  });

  it('each say how they are written and how many bytes they take there, and the request counts them', async () => {
    const input = { content: page.reference, file: photo.reference };
    const asText = Buffer.byteLength(JSON.stringify(Buffer.from(page.content).toString('utf8')));
    const asBase64 = 2 + 8;

    expect(await planned(input)).toMatchObject({
      success: {
        sent: [
          { pointer: '/content', encoding: 'text', bytes: asText },
          { pointer: '/file', encoding: 'base64', bytes: asBase64 },
        ],
        requestBytes: Buffer.byteLength(JSON.stringify({ content: '', file: '' })) - 4 + asText + asBase64,
      },
    });
  });
});

describe('the assets a call cannot send', () => {
  it('are refused where one is shaped like an asset and is none, or a text goes where the tool takes a list', async () => {
    const lookalike = { ...page.reference, bytes: 'many' };

    expect([await refusalOf({ content: lookalike }), await refusalOf({ rows: page.reference })]).toEqual([
      {
        because: 'asset_unusable',
        pointer: '/content',
        detail:
          'The argument /content holds the members of an asset without being one; give an asset as the run that made it answered it',
      },
      {
        because: 'asset_not_taken',
        pointer: '/rows',
        detail:
          'The argument /rows is an asset of text/plain, of a kind the save tool of files does not take there; a tool takes a text where its schema says string, a JSON value where it says object or array, and a file where it says format: byte or contentEncoding: base64; send it where the tool takes that kind, or to a tool that does',
      },
    ]);
  });

  it('are refused where JSON holds no one value, nests too deep or is not UTF-8, each saying which and what to do', async () => {
    const refusals = await Promise.all([broken, deep, notUtf8].map(({ reference }) => refusalOf({ rows: reference })));

    expect(refusals.map(({ detail }) => detail)).toEqual(notJsonWords);
    expect([await planned({ content: broken.reference }), await planned({ file: notUtf8.reference })]).toMatchObject([
      { success: { sent: [{ encoding: 'text' }] } },
      { success: { sent: [{ encoding: 'base64' }] } },
    ]);
  });

  it('are refused where the content of one is no longer kept as it is measured', async () => {
    expect(await refusalOf({ content: gone.reference })).toEqual({
      because: 'asset_unusable',
      pointer: '/content',
      detail:
        'The argument /content names an asset that cannot be sent: The content of the asset asset-gone is no longer kept; run again what made it, for a fresh copy',
    });
  });
});
