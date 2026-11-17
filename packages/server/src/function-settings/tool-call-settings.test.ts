import { getHeapStatistics } from 'node:v8';

import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { readSettingsOf } from '../testing/settings/shipped-settings.ts';
import { heapBytesForEachRequestByte, processHeapBytes, readToolCallSettings } from './tool-call-settings.ts';

const mebibyte = 1_048_576;

const outOfRange =
  'InvalidSettingsError: The tool call settings are invalid. TOOL_CALL_MAX_REQUEST_MIB: Expected a whole number from 1 to 128, such as 16';

function errorFrom(environment: Readonly<Record<string, string>>): string {
  try {
    readSettingsOf(environment);
  } catch (error) {
    return String(error);
  }
  return 'no error';
}

describe('the most one tool call may send', () => {
  it('is 16 MiB unless TOOL_CALL_MAX_REQUEST_MIB sets it, from 1 to 128', () => {
    expect(
      [{}, { TOOL_CALL_MAX_REQUEST_MIB: '1' }, { TOOL_CALL_MAX_REQUEST_MIB: '128' }].map(
        (environment: Readonly<Record<string, string>>) => readSettingsOf(environment).toolCalls.mostRequestBytes,
      ),
    ).toEqual([16 * mebibyte, mebibyte, 128 * mebibyte]);
  });

  it.each(['0', '129', '256', 'many', '1.5'])('stops the server from starting at %s, never with the value', (most) => {
    expect(errorFrom({ TOOL_CALL_MAX_REQUEST_MIB: most })).toBe(outOfRange);
  });

  it('stops the server from starting where one call of that size needs more memory than the process may use', () => {
    const heldByOneCall = 64 * mebibyte * heapBytesForEachRequestByte;

    expect([
      Effect.runSync(readToolCallSettings({ TOOL_CALL_MAX_REQUEST_MIB: '64' }, heldByOneCall)),
      Effect.runSync(Effect.flip(readToolCallSettings({ TOOL_CALL_MAX_REQUEST_MIB: '64' }, heldByOneCall - 1))).message,
    ]).toEqual([
      { mostRequestBytes: 64 * mebibyte },
      'The tool call settings are invalid. TOOL_CALL_MAX_REQUEST_MIB: one call of that size needs more memory than this process may use; lower it, or give the process more memory',
    ]);
  });

  it('reads the memory the process may use from the limit of its heap', () => {
    expect(processHeapBytes()).toBe(getHeapStatistics().heap_size_limit);
  });
});
