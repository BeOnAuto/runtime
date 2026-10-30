import { describe, expect, it } from 'vitest';

import { withoutTrailingSlashes } from '../index.ts';

describe('a base URL read from a setting', () => {
  it('loses the slashes it ends in, however many, and keeps a run of them before its path', () => {
    const run = '/'.repeat(200_000);

    expect([
      withoutTrailingSlashes('https://graph.example.com/v1///'),
      withoutTrailingSlashes('https://graph.example.com/v1'),
      withoutTrailingSlashes(`https://graph.example.com${run}v1${run}`),
    ]).toEqual(['https://graph.example.com/v1', 'https://graph.example.com/v1', `https://graph.example.com${run}v1`]);
  });
});
