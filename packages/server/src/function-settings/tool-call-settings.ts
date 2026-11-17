import { getHeapStatistics } from 'node:v8';

import type { Environment } from '@on.auto/config';
import { Effect } from 'effect';

import { InvalidSettingsError } from '../settings/invalid-settings-error.ts';
import { countsIn } from './counted-settings.ts';

export interface ToolCallSettings {
  readonly mostRequestBytes: number;
}

const mebibyte = 1_048_576;

const mostRequest = { setting: 'TOOL_CALL_MAX_REQUEST_MIB', least: 1, most: 128, example: 16 };

export const heapBytesForEachRequestByte = 3;

export const toolCallVariables: readonly string[] = [mostRequest.setting];

const settings = 'tool call settings';

const pastTheHeap = new InvalidSettingsError({
  message: `The ${settings} are invalid. ${mostRequest.setting}: one call of that size needs more memory than this process may use; lower it, or give the process more memory`,
});

export function processHeapBytes(): number {
  return getHeapStatistics().heap_size_limit;
}

export function readToolCallSettings(
  environment: Environment,
  heapBytes: number,
): Effect.Effect<ToolCallSettings, InvalidSettingsError> {
  return Effect.flatMap(countsIn(environment, { settings, bounds: { mostRequest } }), ({ mostRequest: mebibytes }) => {
    const mostRequestBytes = mebibytes * mebibyte;
    return mostRequestBytes * heapBytesForEachRequestByte > heapBytes
      ? Effect.fail(pastTheHeap)
      : Effect.succeed({ mostRequestBytes });
  });
}
