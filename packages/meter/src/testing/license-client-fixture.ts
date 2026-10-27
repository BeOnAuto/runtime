import { openLicenseClient } from '../index.ts';
import { testClock } from './clock-fixture.ts';
import { licenseAuthority } from './license-authority.ts';
import { licenseFixture } from './license-fixture.ts';
import { sqliteDatabase } from './sqlite-database.ts';

export async function licenseClientFixture(open = sqliteDatabase) {
  const signing = await licenseFixture(open);
  const time = testClock();
  const authority = licenseAuthority(signing, time.pass);
  const options = {
    connection: time.on(signing.database.connection),
    secrets: signing.database.secrets,
    trust: signing.trust,
    clock: time.samples,
    fetch: authority.fetch,
  };
  const client = await openLicenseClient(options);
  function pass(elapsed: number) {
    time.pass(elapsed);
    authority.state.now += elapsed;
  }
  async function restart() {
    const database = await signing.database.reopen();
    return openLicenseClient({ ...options, connection: time.on(database.connection), secrets: database.secrets });
  }
  return { ...signing, options, authority, time, client, pass, restart };
}
