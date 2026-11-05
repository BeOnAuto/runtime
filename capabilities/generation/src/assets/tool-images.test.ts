import { at } from '@on.auto/content/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { generationBounds } from '../capability/generation-ports.ts';
import { assetIdOf, day } from '../run-testing/run-outcomes.ts';
import { alpha, generationHarness, harnessStartsAt, onePixelPng, type GenerationHarness } from '../testing/index.ts';
import { toolImagesKept, type ToolImagePorts, type ToolImageToKeep } from './tool-images.ts';

const screenshot: ToolImageToKeep = {
  playbook: alpha,
  bytes: onePixelPng,
  call: {
    call_id: 'toolu_01',
    server: 'browser',
    connection_id: '019a5b10-7e2c-7f41-9a3d-5c8e2b6f1d07',
    tool: 'browser_take_screenshot',
  },
  context: {
    by: 'acme-admin',
    runId: 'run-1',
    definitionType: 'reasoning',
    definitionName: 'check-the-order',
    definitionVersion: 2,
  },
  lineage: { causationId: 'start-1', correlationId: 'run-1' },
};

function keepingIn(playbook: GenerationHarness, bounds: ToolImagePorts['bounds'] = generationBounds) {
  const made = { count: 0 };
  return toolImagesKept({
    ledger: playbook.ledger.service,
    content: playbook.ledger.service.content,
    bounds,
    newAssetId: () => {
      made.count += 1;
      return assetIdOf(made.count);
    },
  });
}

describe('an image a tool call answered', () => {
  it('is kept as an asset of the run, made by that call, for as long as the runtime keeps an asset, and answers its id', async () => {
    const playbook = generationHarness();
    const keep = keepingIn(playbook, { ...generationBounds, keptMs: 30 * day });

    const kept = await at(harnessStartsAt, keep(screenshot));

    expect(kept).toBe(assetIdOf(1));
    expect(await playbook.factsOf(assetIdOf(1))).toMatchObject([
      {
        type: 'asset_kept',
        data: {
          media_type: 'image/png',
          bytes: onePixelPng.byteLength,
          kind: 'image',
          made_by: { tool_call: screenshot.call },
          expires_at: new Date(harnessStartsAt + 30 * day).toISOString(),
        },
        context: { ...screenshot.context, at: new Date(harnessStartsAt).toISOString() },
      },
    ]);
    expect(await playbook.rowOf(assetIdOf(1))).toMatchObject({ kind: 'image', model: null, run: 'run-1', live: true });
  });

  it('is kept as the image its bytes are, and names no connection where the call went through none', async () => {
    const playbook = generationHarness();
    const ofAServer = { call_id: 'toolu_01', server: 'graph', tool: 'chart' };

    await at(harnessStartsAt, keepingIn(playbook)({ ...screenshot, call: ofAServer }));

    expect(await playbook.factsOf(assetIdOf(1))).toMatchObject([
      { data: { media_type: 'image/png', made_by: { tool_call: ofAServer } } },
    ]);
    expect(await playbook.rowOf(assetIdOf(1))).toMatchObject({ media_type: 'image/png', model: null });
  });
});

describe('an image a tool call answered, past what the runtime keeps', () => {
  it('is not kept where its bytes are of no image the runtime knows, larger than an image may be, or past what the playbook may keep', async () => {
    const playbook = generationHarness();
    const notAnImage = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
    const keep = keepingIn(playbook);
    const tooLarge = keepingIn(playbook, {
      ...generationBounds,
      mostBytes: { ...generationBounds.mostBytes, image: 8 },
    });
    const full = keepingIn(playbook, { ...generationBounds, mostPlaybookBytes: 0 });

    expect(
      await Promise.all([
        at(harnessStartsAt, keep({ ...screenshot, bytes: notAnImage })),
        at(harnessStartsAt, tooLarge(screenshot)),
        at(harnessStartsAt, full(screenshot)),
      ]),
    ).toEqual([undefined, undefined, undefined]);
    expect(await playbook.totals()).toEqual({ bytes: 0, assets: 0 });
  });
});

describe('an image a tool call answered, where the runtime gives no ids', () => {
  it('is kept under a version 7 UUID where the runtime gives no ids of its own', async () => {
    const playbook = generationHarness();
    const keep = toolImagesKept({ ledger: playbook.ledger.service, content: playbook.ledger.service.content });

    const kept = await Effect.runPromise(keep(screenshot));

    expect(kept).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    expect(await playbook.totals()).toEqual({ bytes: onePixelPng.byteLength, assets: 1 });
  });
});
