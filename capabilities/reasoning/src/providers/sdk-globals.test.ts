import { NoSuchModelError } from 'ai';
import { describe, expect, it } from 'vitest';

import { installSdkGlobals } from './sdk-globals.ts';

describe('installSdkGlobals', () => {
  it('makes a bare model string fail instead of reaching a default gateway', () => {
    installSdkGlobals();

    expect(() => globalThis.AI_SDK_DEFAULT_PROVIDER?.languageModel('gpt-5')).toThrow(NoSuchModelError);
  });

  it('keeps the SDK from writing warnings to the console', () => {
    installSdkGlobals();

    expect(globalThis.AI_SDK_LOG_WARNINGS).toBe(false);
  });
});
