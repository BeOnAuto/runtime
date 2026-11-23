import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { servingReasoning, type ReasoningServer } from '../servers/reasoning-server.ts';
import { servedDocumentText, servedSchemaText } from './served-document-text.ts';

let server: ReasoningServer;
let throwaway: string;
let throwawaySchema: string;

beforeAll(async () => {
  [server, throwaway, throwawaySchema] = await Promise.all([
    servingReasoning([], undefined, undefined, { goals: true, goalsResults: true }),
    servedDocumentText(),
    servedSchemaText(),
  ]);
});

afterAll(async () => {
  await server.stop();
});

describe('the document text of a throwaway server', () => {
  it('is the text a running server answers at /v1/openapi.json, byte for byte', async () => {
    expect(throwaway).toBe(await (await fetch(`${server.origin}/v1/openapi.json`)).text());
  });

  it('is the query schema a running server answers at /v1/schema.graphql, byte for byte', async () => {
    expect(throwawaySchema).toBe(await (await fetch(`${server.origin}/v1/schema.graphql`)).text());
  });
});
