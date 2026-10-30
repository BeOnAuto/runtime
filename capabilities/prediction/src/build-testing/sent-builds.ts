import { expect } from 'vitest';

import { uploadedDailyVisits } from '../testing/daily-documents.ts';
import type { BuildPlaybook } from './build-playbook.ts';
import { askedBuild, savedFunction, visitsRows } from './built-versions.ts';
import { sendingDocument } from './called-documents.ts';

export async function sentThrough(playbook: BuildPlaybook, expires = 'P1D'): Promise<string> {
  expect(
    await playbook.call(playbook.operations.create, {
      type: 'interaction',
      name: 'send-build',
      source: sendingDocument(expires),
    }),
  ).toMatchObject({ status: 'succeeded' });
  const source = uploadedDailyVisits(visitsRows.sha256).replace(
    '  expires: P1D',
    '  expires: P1D\n  through: send-build',
  );
  await savedFunction(playbook, { source });
  return askedBuild(playbook);
}
