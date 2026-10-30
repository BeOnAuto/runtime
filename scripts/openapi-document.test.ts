import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import manifest from '../package.json' with { type: 'json' };
import { keptDocumentOf, writeOpenApiDocument } from './openapi-document.ts';

async function withTemporaryDocument(verify: (path: string) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'auto-runtime-openapi-'));
  try {
    await verify(join(directory, 'openapi.json'));
  } finally {
    rmSync(directory, { recursive: true });
  }
}

await test('the kept document is the served one, two spaces deep, with a final newline', async () => {
  await withTemporaryDocument(async (path) => {
    await writeOpenApiDocument(path, () => Promise.resolve('{"info":{"version":"1.2.3"},"servers":[{"url":"/v1"}]}'));
    assert.equal(
      readFileSync(path, 'utf8'),
      '{\n  "info": {\n    "version": "1.2.3"\n  },\n  "servers": [\n    {\n      "url": "/v1"\n    }\n  ]\n}\n',
    );
  });
});

await test('the command writes the document a throwaway server of this release serves', async () => {
  await withTemporaryDocument(async (path) => {
    await writeOpenApiDocument(path);
    const written = readFileSync(path, 'utf8');
    const document: unknown = JSON.parse(written);
    assert.equal(keptDocumentOf(written), written);
    assert.partialDeepStrictEqual(document, { openapi: '3.1.1', info: { version: manifest.version } });
  });
});
