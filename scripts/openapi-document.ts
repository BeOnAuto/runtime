import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { servedDocumentText, servedSchemaText } from '@on.auto/server/openapi-document';

export function keptDocumentOf(servedText: string): string {
  const document: unknown = JSON.parse(servedText);
  return `${JSON.stringify(document, null, 2)}\n`;
}

export async function writeOpenApiDocument(path: string, served = servedDocumentText): Promise<void> {
  writeFileSync(path, keptDocumentOf(await served()));
}

export async function writeQuerySchema(path: string, served = servedSchemaText): Promise<void> {
  writeFileSync(path, await served());
}

if (import.meta.main) {
  await writeOpenApiDocument(resolve(import.meta.dirname, '../docs/assets/openapi.json'));
  await writeQuerySchema(resolve(import.meta.dirname, '../docs/assets/schema.graphql'));
}
