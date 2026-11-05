import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import {
  imageCallOf,
  imagesKeptOutOf,
  imagesOfTheCall,
  type ImageCall,
  type KeepImageOfTheCall,
} from './answered-images.ts';

const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const screenshot = { type: 'image', data: pixel, mimeType: 'image/png', annotations: { audience: ['user'] } };

const sound = { type: 'audio', data: pixel, mimeType: 'audio/wav' };

const words = { type: 'text', text: 'The page shows the order.' };

function keptAs(...assets: readonly (string | undefined)[]) {
  const asked: string[] = [];
  const keep: KeepImageOfTheCall = (bytes) => {
    asked.push(Buffer.from(bytes).toString('base64'));
    return Promise.resolve(assets[asked.length - 1]);
  };
  return { keep, asked };
}

describe('the images a tool answered', () => {
  it('are kept out of the answer, each block naming its asset in place of its bytes, and nothing else of the answer changes', async () => {
    const { keep, asked } = keptAs('asset-1', 'asset-2');
    const answer = JSON.stringify({ content: [words, screenshot, sound, screenshot], isError: false });

    const kept = await imagesKeptOutOf(answer, keep);

    expect(JSON.parse(kept)).toEqual({
      content: [
        words,
        { type: 'image', mimeType: 'image/png', annotations: { audience: ['user'] }, asset: 'asset-1' },
        sound,
        { type: 'image', mimeType: 'image/png', annotations: { audience: ['user'] }, asset: 'asset-2' },
      ],
      isError: false,
    });
    expect(asked).toEqual([pixel, pixel]);
  });

  it('stay in the answer as the tool sent them where none is kept, and the answer is kept as it was received', async () => {
    const { keep } = keptAs(undefined, 'asset-2');
    const answer = JSON.stringify({ content: [screenshot] });
    const withTwo = JSON.stringify({ content: [screenshot, screenshot] });

    expect([await imagesKeptOutOf(answer, keep), await imagesKeptOutOf(answer)]).toEqual([answer, answer]);
    expect(JSON.parse(await imagesKeptOutOf(withTwo, keptAs(undefined, 'asset-2').keep))).toEqual({
      content: [
        screenshot,
        { type: 'image', mimeType: 'image/png', annotations: { audience: ['user'] }, asset: 'asset-2' },
      ],
    });
  });

  it('are none in an answer of no content, or in a block whose bytes are not written as text', async () => {
    const { keep, asked } = keptAs('asset-1');
    const structured = JSON.stringify({ structuredContent: { rows: 2 } });
    const unwritten = JSON.stringify({ content: [{ type: 'image', data: 7, mimeType: 'image/png' }] });

    expect([await imagesKeptOutOf(structured, keep), await imagesKeptOutOf(unwritten, keep)]).toEqual([
      structured,
      unwritten,
    ]);
    expect(asked).toEqual([]);
  });
});

describe('the call an image is kept for', () => {
  it('names the id the model gave the call, its server, the connection where it is one, and its tool', async () => {
    const calls: ImageCall[] = [];
    const call = imageCallOf('toolu_01', { name: 'browser', connection: 'connection-1' }, 'browser_take_screenshot');
    const keep = imagesOfTheCall((_bytes, of) => {
      calls.push(of);
      return Promise.resolve('asset-1');
    }, call);

    await keep?.(Buffer.from(pixel, 'base64'));

    expect(calls).toEqual([
      { call_id: 'toolu_01', server: 'browser', connection_id: 'connection-1', tool: 'browser_take_screenshot' },
    ]);
    expect(imageCallOf('call-2', { name: 'graph', connection: null }, 'chart')).toEqual({
      call_id: 'call-2',
      server: 'graph',
      tool: 'chart',
    });
    expect(imagesOfTheCall(undefined, call)).toBeUndefined();
  });
});
