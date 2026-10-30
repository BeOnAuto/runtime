import { sha256Of } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { secretsOf } from '../bounds/secrets.ts';
import { answeredFields, recordingOf, scrubbedJsonOf } from './recorded-calls.ts';

function textAnswer(text: string): string {
  return JSON.stringify({ content: [{ type: 'text', text }] });
}

describe('the content of one answer received before and after a secret is minted', () => {
  it('is kept as two texts under two digests, and each fact names its own', async () => {
    const minted = 'minted-token-0123456789';
    const secrets = secretsOf([]);
    const keptTexts = new Map<string, string>();
    const recording = recordingOf({ record_content: true, request_id: null, connection: null }, secrets, (text) => {
      keptTexts.set(sha256Of(text), text);
      return Promise.resolve(sha256Of(text));
    });
    const received = textAnswer(`the session is ${minted}`);
    const answeredOnce = () =>
      answeredFields({ keptJson: scrubbedJsonOf(received, recording), jsonrpcId: 1, serverRequestId: null }, recording);

    const before = await answeredOnce();
    secrets.replace('graph', minted);
    const after = await answeredOnce();

    expect([before.result_sha256, after.result_sha256].map((sha256) => keptTexts.get(String(sha256)))).toEqual([
      received,
      textAnswer('the session is [redacted]'),
    ]);
    expect(new Set([before.result_sha256, after.result_sha256]).size).toBe(2);
  });
});
