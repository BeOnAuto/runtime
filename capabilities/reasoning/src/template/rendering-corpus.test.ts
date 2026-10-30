import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { renderedCorpusOf } from './rendered-corpus.ts';
import { renderingCorpus } from './rendering-corpus.ts';

const captured: unknown = JSON.parse(readFileSync(new URL('rendering-corpus.json', import.meta.url), 'utf8'));

describe('the reasoning templates of the rendering tests', () => {
  it('render as they rendered when the corpus was captured, before the engine moved', () => {
    expect(renderedCorpusOf(renderingCorpus)).toEqual(captured);
  });
});
