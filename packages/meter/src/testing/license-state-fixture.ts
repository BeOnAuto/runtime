import { openLicenseState, type LicenseRecordRequest } from '../index.ts';
import { licenseFixture } from './license-fixture.ts';
import { sqliteDatabase } from './sqlite-database.ts';

export async function licenseStateFixture(open = sqliteDatabase) {
  const f = await licenseFixture(open);
  const options = { connection: f.database.connection, installation: f.installation, trust: f.trust };
  const state = await openLicenseState(options);
  const challenge = await f.challenge();
  const bundle = await f.bundle(challenge);
  const request: LicenseRecordRequest = { expectedRevision: 0, challenge, ...bundle, now: 5000 };
  async function next(expectedRevision = 1, generation = 1): Promise<LicenseRecordRequest> {
    const nextChallenge = { ...(await f.challenge('refresh', crypto.randomUUID())), generation };
    return { expectedRevision, challenge: nextChallenge, ...(await f.bundle(nextChallenge)), now: 5000 };
  }
  return { ...f, state, options, request, next };
}
