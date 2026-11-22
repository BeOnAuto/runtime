import { defineConfig, mergeConfig } from 'vitest/config';

import { sharedConfig } from '../../vitest.shared.ts';

export default mergeConfig(
  sharedConfig,
  defineConfig({ test: { name: 'operations', globalSetup: ['test-setup/compiled-probes.ts'] } }),
);
