import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { servedDocumentText } from '@on.auto/server/openapi-document';

export function keptDocumentOf(servedText: string): string {
  const document: unknown = JSON.parse(servedText);
  return `${JSON.stringify(document, null, 2)}\n`;
}

export async function writeOpenApiDocument(path: string, served = servedDocumentText): Promise<void> {
  writeFileSync(path, keptDocumentOf(await served()));
}

if (import.meta.main) {
  await writeOpenApiDocument(resolve(import.meta.dirname, '../docs/assets/openapi.json'));
}
