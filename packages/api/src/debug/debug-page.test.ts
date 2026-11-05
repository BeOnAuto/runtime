import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { debugPageServer, type DebugPageServer } from '../testing/debug-pages.ts';

let served: DebugPageServer;

beforeAll(async () => {
  served = await debugPageServer();
});

afterAll(async () => {
  await served.close();
});

describe('a tool on the page at /debug', () => {
  it('shows each argument with its type and whether it is required, a nested one by its path', () => {
    const { text } = served.page;
    expect(text).toContain('<td>name<span class="required">required</span></td>');
    expect(text).toContain('<td><code>string | null</code></td>');
    expect(text).toContain('<td>size.pages<span class="required">required</span></td>');
    expect(text).toContain('<p class="subtitle">Takes no arguments.</p>');
  });

  it('shows the values an argument takes, its pattern or its longest length', () => {
    const { text } = served.page;
    expect(text).toContain('One of <code>plain</code>, <code>fancy</code>');
    expect(text).toContain('<p class="limit">Pattern <code>');
    expect(text).toContain('<p class="limit">At most 100 characters</p>');
  });

  it('shows what its annotations hint', () => {
    const { text } = served.page;
    expect(text).toMatch(/<ul class="hints">\s*<li>reads only<\/li><li>safe to repeat<\/li>\s*<\/ul>/u);
    expect(text).toContain('<li>reads only</li><li>safe to repeat</li><li>reaches outside</li>');
    expect(text).toMatch(/<ul class="hints">\s*<li>may destroy<\/li>\s*<\/ul>/u);
  });
});
