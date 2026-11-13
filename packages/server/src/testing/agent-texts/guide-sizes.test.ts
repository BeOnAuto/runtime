import { Buffer } from 'node:buffer';

import { mostGuideBytes } from '@on.auto/api';
import { beforeAll, describe, expect, it } from 'vitest';

import { servedByAThrowawayServer } from './served-to-an-agent.ts';

const bytesLeftForHostSentences = 2048;

const bytesOfTheFirstScreen = 1500;

interface SizedGuide {
  readonly name: string;
  readonly bytes: number;
}

let guides: readonly SizedGuide[];

let interactionGuide: string;

beforeAll(async () => {
  const { surface } = await servedByAThrowawayServer();
  const served = surface.connections.flatMap((connection) => connection.guides);
  const largest = new Map<string, SizedGuide>();
  for (const { name, text } of served) {
    const bytes = Buffer.byteLength(text);
    if (bytes > (largest.get(name)?.bytes ?? 0)) {
      largest.set(name, { name, bytes });
    }
  }
  guides = [...largest.values()];
  interactionGuide = served.find((guide) => guide.name === 'interaction-function')?.text ?? '';
});

function remainingOf({ name, bytes }: SizedGuide): string {
  return `${name}: ${String(mostGuideBytes - bytes)} bytes remain of the ${String(mostGuideBytes)} a guide may hold`;
}

describe('the guides of the largest shelf, with every capability and the pages', () => {
  it('serve the card guide beside the interaction guide', () => {
    expect(guides.map(({ name }) => name)).toEqual(expect.arrayContaining(['interaction-function', 'render-slack']));
  });

  it(`leave every guide ${String(bytesLeftForHostSentences)} bytes under the most a guide may hold, for what a host adds to a guide`, () => {
    const tight = guides
      .filter(({ bytes }) => mostGuideBytes - bytes < bytesLeftForHostSentences)
      .map((guide) => remainingOf(guide));

    expect(tight, `Guides within ${String(bytesLeftForHostSentences)} bytes of the limit`).toEqual([]);
  });
});

describe('the interaction guide', () => {
  it('names the card guide within the first screen a client shows of a long text', () => {
    const before = interactionGuide.slice(0, interactionGuide.indexOf('render-slack'));

    expect(interactionGuide).toContain('render-slack');
    expect(Buffer.byteLength(before)).toBeLessThan(bytesOfTheFirstScreen);
  });
});
