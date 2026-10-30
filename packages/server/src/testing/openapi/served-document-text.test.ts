import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { servingReasoning, type ReasoningServer } from '../servers/reasoning-server.ts';
import { servedDocumentText } from './served-document-text.ts';

let server: ReasoningServer;
let throwaway: string;

beforeAll(async () => {
  [server, throwaway] = await Promise.all([servingReasoning([]), servedDocumentText()]);
});

afterAll(async () => {
  await server.stop();
});

describe('the document text of a throwaway server', () => {
  it('is the text a running server answers at /v1/openapi.json, byte for byte', async () => {
    expect(throwaway).toBe(await (await fetch(`${server.origin}/v1/openapi.json`)).text());
  });
});
