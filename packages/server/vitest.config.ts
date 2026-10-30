import { defineConfig, mergeConfig } from 'vitest/config';

import { sharedConfigSetUpBy } from '../../vitest.shared.ts';

export default mergeConfig(
  sharedConfigSetUpBy('src/testing/test-run/test-run-folder.ts'),
  defineConfig({ test: { name: 'server' } }),
);
