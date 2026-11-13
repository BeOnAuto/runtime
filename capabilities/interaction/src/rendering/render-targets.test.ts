import { describe, expect, it } from 'vitest';

import { isRenderTargetName, renderTargetNames } from './render-targets.ts';

describe('the render targets', () => {
  it('are slack alone for now', () => {
    expect(renderTargetNames).toEqual(['slack']);
  });

  it('tell a target from any other written name', () => {
    expect(isRenderTargetName('slack')).toBe(true);
    expect(isRenderTargetName('email')).toBe(false);
    expect(isRenderTargetName('toString')).toBe(false);
  });
});
