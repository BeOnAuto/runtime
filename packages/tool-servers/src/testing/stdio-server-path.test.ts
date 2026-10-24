import { fileURLToPath } from 'node:url';

import { importedWithoutAnAddress } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import { fakeStdioServerPath } from './index.ts';

describe('the testing entry of the tool servers', () => {
  it('loads where import.meta.url names no file, and names the stdio server a test runs only when it asks', async () => {
    const loaded = await importedWithoutAnAddress(new URL('./index.ts', import.meta.url));

    expect(Object.keys(loaded)).toContain('fakeStdioServerPath');
    expect(fakeStdioServerPath()).toBe(fileURLToPath(new URL('../mcp-testing/fake-stdio-server.ts', import.meta.url)));
  });
});
