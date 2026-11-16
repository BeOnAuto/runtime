import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { shippedToolsFile, shippedToolsText } from '../testing/shipped-additions.ts';

describe('the tools every shipped document offers, by the way of each provider', () => {
  it('are committed as the bridge derives them, each tool by the digest of what an agent is listed; pnpm --filter @on.auto/connections shipped-tools writes them again', async () => {
    expect(readFileSync(shippedToolsFile, 'utf8')).toBe(await shippedToolsText());
  });
});
