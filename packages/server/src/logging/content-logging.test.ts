import { describe, expect, it } from 'vitest';

import { linesLoggedBy } from '../testing/records/logged-lines.ts';
import { logContentStore } from './logging.ts';

describe('logContentStore', () => {
  it("says content is kept in the ledger's database when no object store is set", async () => {
    await expect(linesLoggedBy(logContentStore({ store: 'ledger' }))).resolves.toEqual([
      expect.stringMatching(
        /^\{"message":"Content is kept in the ledger's database","level":"INFO",.*"annotations":\{"content_store":"ledger"\}/u,
      ),
    ]);
  });

  it('names the bucket, the prefix and the host of the endpoint of an object store, and nothing else of its URL', async () => {
    const lines = await linesLoggedBy(
      logContentStore({
        store: 'object-storage',
        location: { bucket: 'playbook-content', prefix: 'production' },
        endpoint: 'https://access:secret@storage.example.com:9000/base',
        region: 'eu-west-1',
      }),
    );

    expect(lines).toEqual([
      expect.stringContaining(
        '{"message":"Content is kept on object storage, in the bucket playbook-content under production/, on storage.example.com:9000","level":"INFO"',
      ),
    ]);
    expect(lines[0]).toContain(
      '"annotations":{"content_store":"object-storage","content_bucket":"playbook-content","content_prefix":"production","content_endpoint":"storage.example.com:9000"}',
    );
    expect(lines.join('\n')).not.toMatch(/secret|access/u);
  });

  it('names the endpoint of the region when no endpoint is set, and no prefix when it has none', async () => {
    const lines = await linesLoggedBy(
      logContentStore({
        store: 'object-storage',
        location: { bucket: 'playbook-content', prefix: '' },
        endpoint: undefined,
        region: undefined,
      }),
    );

    expect(lines).toEqual([
      expect.stringContaining(
        '{"message":"Content is kept on object storage, in the bucket playbook-content, on the S3 endpoint of its region"',
      ),
    ]);
  });
});
