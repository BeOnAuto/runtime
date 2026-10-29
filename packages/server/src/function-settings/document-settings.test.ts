import { describe, expect, it } from 'vitest';

import { readSettingsOf } from '../testing/settings/shipped-settings.ts';

const processesRefused =
  'InvalidSettingsError: The document settings are invalid. DOCUMENT_PROCESSES: Expected a whole number from 1 to 64, such as 2';

function errorFrom(environment: Readonly<Record<string, string>>): string {
  try {
    readSettingsOf(environment);
  } catch (error) {
    return String(error);
  }
  return 'no error';
}

describe('the document settings', () => {
  it('read the most processes that read documents at once, 2 unless set', () => {
    expect(
      [{}, { DOCUMENT_PROCESSES: '1' }, { DOCUMENT_PROCESSES: ' 64 ' }].map(
        (environment: Readonly<Record<string, string>>) => readSettingsOf(environment).documents.processes,
      ),
    ).toEqual([2, 1, 64]);
  });

  it.each(['0', 'some', '65'])('stop the server from starting at %s processes', (processes) => {
    expect(errorFrom({ DOCUMENT_PROCESSES: processes })).toBe(processesRefused);
  });
});
