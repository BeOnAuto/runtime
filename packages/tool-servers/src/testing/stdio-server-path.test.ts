import { fileURLToPath } from 'node:url';

import { importedWithoutAnAddress } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import { fakeStdioServerPath } from './served-fakes.ts';

describe('the testing entries of the tool servers', () => {
  it('load where import.meta.url names no file, and name the stdio server a test runs only when it asks', async () => {
    const [testing, served] = await Promise.all([
      importedWithoutAnAddress(new URL('./index.ts', import.meta.url)),
      importedWithoutAnAddress(new URL('./served-fakes.ts', import.meta.url)),
    ]);

    expect(Object.keys(testing)).toContain('fakeMcpAnswers');
    expect(Object.keys(served)).toContain('fakeStdioServerPath');
    expect(fakeStdioServerPath()).toBe(fileURLToPath(new URL('../mcp-testing/fake-stdio-server.ts', import.meta.url)));
  });
});
