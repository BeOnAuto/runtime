import { customProvider } from 'ai';

const failClosed = customProvider({});

export function installSdkGlobals(): void {
  globalThis.AI_SDK_DEFAULT_PROVIDER = failClosed;
  globalThis.AI_SDK_LOG_WARNINGS = false;
}
