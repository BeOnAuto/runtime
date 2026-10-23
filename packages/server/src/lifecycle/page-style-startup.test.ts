import type { ShippedFiles } from '@on.auto/operations';
import { shippedFilesOnDisk } from '@on.auto/operations/shipped-files-on-disk';
import { describe, expect, it } from 'vitest';

import { defaultServerOptions } from '../testing/entries/serving-options.ts';
import { startServer } from './lifecycle.ts';

const withoutTypefaces: ShippedFiles = {
  ...shippedFilesOnDisk,
  bytes: (file) =>
    file.pathname.endsWith('.woff2')
      ? Promise.reject(new Error(`No file is shipped at ${file.href}`))
      : shippedFilesOnDisk.bytes(file),
};

describe('a server whose pages cannot be styled', () => {
  it('does not start when a typeface its pages carry cannot be read, and names the file', async () => {
    const options = { ...defaultServerOptions, shippedFiles: withoutTypefaces };

    await expect(startServer({ HOST: '127.0.0.1', PORT: '0' }, options)).rejects.toThrow(
      /^No file is shipped at file:.*\.woff2$/u,
    );
  });
});
