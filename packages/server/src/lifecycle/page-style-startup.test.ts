import { shippedFileName, type ShippedFiles } from '@on.auto/operations';
import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import { describe, expect, it } from 'vitest';

import { shippedRoots } from '../server-options/shipped-roots.ts';
import { defaultServerOptions } from '../testing/entries/serving-options.ts';
import { startServer } from './lifecycle.ts';

const shippedOnDisk = shippedFilesOnDisk(shippedRoots);

const withoutTypefaces: ShippedFiles = {
  ...shippedOnDisk,
  bytes: (file) =>
    file.path.endsWith('.woff2')
      ? Promise.reject(new Error(`No file is shipped at ${shippedFileName(file)}`))
      : shippedOnDisk.bytes(file),
};

describe('a server whose pages cannot be styled', () => {
  it('does not start when a typeface its pages carry cannot be read, and names the file', async () => {
    const options = { ...defaultServerOptions, shippedFiles: withoutTypefaces };

    await expect(startServer({ HOST: '127.0.0.1', PORT: '0' }, options)).rejects.toThrow(
      /^No file is shipped at @on\.auto\/api\/.*\.woff2$/u,
    );
  });
});
