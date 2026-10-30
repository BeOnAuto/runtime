import { describe, expect, it } from 'vitest';

import { readSettingsOf } from '../testing/settings/shipped-settings.ts';

function errorFrom(environment: Readonly<Record<string, string>>): string {
  try {
    readSettingsOf(environment);
  } catch (error) {
    return String(error);
  }
  return 'no error';
}

describe('the document settings', () => {
  it('keep 2 processes that read documents at once, of 1,280 MiB each, when nothing is set', () => {
    expect(readSettingsOf({}).documents).toEqual({ processes: 2, processMemoryMebibytes: 1280 });
  });

  it('read the most processes that read documents at once and the memory of each', () => {
    expect(
      [
        { DOCUMENT_PROCESSES: '1', DOCUMENT_PROCESS_MEMORY: '768' },
        { DOCUMENT_PROCESSES: ' 64 ', DOCUMENT_PROCESS_MEMORY: ' 16384 ' },
      ].map((environment: Readonly<Record<string, string>>) => readSettingsOf(environment).documents),
    ).toMatchObject([
      { processes: 1, processMemoryMebibytes: 768 },
      { processes: 64, processMemoryMebibytes: 16_384 },
    ]);
  });

  it('look for prlimit in the PATH the server was started with, and nowhere without one', () => {
    expect([
      readSettingsOf({ PATH: '/usr/local/bin:/usr/bin' }).documents.path,
      readSettingsOf({}).documents.path,
    ]).toEqual(['/usr/local/bin:/usr/bin', undefined]);
  });

  it.each([
    ['0', '1280', 'DOCUMENT_PROCESSES: Expected a whole number from 1 to 64, such as 2'],
    ['65', '1280', 'DOCUMENT_PROCESSES: Expected a whole number from 1 to 64, such as 2'],
    ['2', '767', 'DOCUMENT_PROCESS_MEMORY: Expected a whole number from 768 to 16384, such as 1280'],
    ['2', 'much', 'DOCUMENT_PROCESS_MEMORY: Expected a whole number from 768 to 16384, such as 1280'],
  ])('stop the server from starting at %s processes of %s MiB', (processes, memory, refused) => {
    expect(errorFrom({ DOCUMENT_PROCESSES: processes, DOCUMENT_PROCESS_MEMORY: memory })).toBe(
      `InvalidSettingsError: The document settings are invalid. ${refused}`,
    );
  });
});
