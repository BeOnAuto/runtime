import { createHash, createHmac } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { accountsServed, installation, servedBy, studio } from '../testing/accounts/licensed-server.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { tallied } from '../testing/servers/tally-server.ts';

const report = '/v1/orgs/acme/license/allocation/report';

const allocationPath = '/v1/orgs/acme/license/allocation';

const madeIn = Schema.decodeUnknownSync(
  Schema.Struct({
    report: Schema.Struct({
      allocation: Schema.String,
      installation: Schema.String,
      sequence: Schema.Number,
      spent: Schema.Number,
      at: Schema.String,
    }),
    signature: Schema.String,
  }),
);

function signatureOf(key: string, fields: readonly (string | number)[]): string {
  const digest = createHash('sha256')
    .update(key.split('.').at(-1) ?? '')
    .digest('hex');
  return createHmac('sha256', digest).update(fields.join('.')).digest('hex');
}

describe('a runtime given an allocation in AUTO_RUNTIME_ALLOCATION, which never reaches Auto', () => {
  it('admits its runs against the allocation itself, up to its credits, and refuses the next as credits_exhausted', async () => {
    const accounts = await accountsServed();
    const allocation = accounts.account.allocationFor(installation, 2);
    accounts.account.goDown();
    const server = await servedBy(accounts, {
      AUTO_RUNTIME_LICENSE_KEY: accounts.key,
      AUTO_RUNTIME_ALLOCATION: JSON.stringify(allocation),
    });
    const ran = [await tallied(server), await tallied(server)];

    expect(ran.map(({ status }) => status)).toEqual([200, 200]);
    expect(await tallied(server)).toMatchObject({
      status: 409,
      body: {
        kind: 'credits_exhausted',
        because: 'none_left',
        detail: `This runtime has used all 2 offline credits. An owner can request more at ${studio}/licenses?installation=${installation}.`,
        resolve_at: `${studio}/licenses?installation=${installation}`,
        runtime_id: installation,
      },
    });
    expect(accounts.account.askedToAdmit()).toBe(0);
  });
});

describe('a runtime given an allocation in license.allocation of its configuration file', () => {
  it('admits its runs against the allocation, and makes its report signed with its key', async () => {
    const accounts = await accountsServed();
    const ledger = temporaryLedger();
    onTestFinished(ledger.remove);
    const configFile = join(ledger.directory, 'auto-runtime.yaml');
    writeFileSync(configFile, 'license:\n  key: ${ACME_KEY}\n  allocation: ${ACME_ALLOCATION}\n');
    const allocation = JSON.stringify(accounts.account.allocationFor(installation, 5));
    const environment = { CONFIG_FILE: configFile, ACME_KEY: accounts.key, ACME_ALLOCATION: allocation };
    const server = await servedBy(accounts, environment, { ledger });
    await tallied(server);
    const made = await server.call('POST', report, { body: {} });
    const { report: fields, signature } = madeIn(made.body);

    expect([made.status, fields.spent, fields.installation]).toEqual([200, 1, installation]);
    expect(fields.sequence).toBeGreaterThan(0);
    expect(signature).toBe(signatureOf(accounts.key, [fields.allocation, installation, fields.sequence, 1, fields.at]));
    expect(accounts.account.askedToAdmit()).toBe(0);
  });
});

describe('an allocation given through the API', () => {
  it('is taken, answering what the runtime holds, and kept on its ledger across a restart', async () => {
    const accounts = await accountsServed();
    const ledger = temporaryLedger();
    onTestFinished(ledger.remove);
    const allocation = accounts.account.allocationFor(installation, 1);
    const before = await servedBy(accounts, {}, { ledger });
    const taken = await before.call('POST', allocationPath, { body: { allocation } });
    await tallied(before);
    await before.stop();
    const after = await servedBy(accounts, {}, { ledger });

    expect(taken).toMatchObject({ status: 200, body: { installation, credits: 1, spent: 0 } });
    expect(await tallied(after)).toMatchObject({ status: 409, body: { kind: 'credits_exhausted' } });
  }, 60_000);

  it('refuses an allocation Auto did not sign, one that is no allocation, and a report without a key', async () => {
    const accounts = await accountsServed();
    accounts.account.answer('tampered');
    const server = await servedBy(accounts);
    const tampered = await server.call('POST', allocationPath, {
      body: { allocation: accounts.account.allocationFor(installation, 5) },
    });
    const malformed = await server.call('POST', allocationPath, { body: { allocation: { payload: 'x' } } });
    const unsigned = await server.call('POST', report, { body: {} });

    expect([tampered.status, malformed.status, unsigned.status]).toEqual([409, 422, 409]);
    expect(tampered.body).toMatchObject({ kind: 'license_invalid' });
  });

  it('warns at the start of an allocation its settings give that it cannot take, and starts all the same', async () => {
    const accounts = await accountsServed();
    accounts.account.answer('by another key');
    const allocation = JSON.stringify(accounts.account.allocationFor(installation, 5));
    const server = await servedBy(accounts, { AUTO_RUNTIME_ALLOCATION: allocation });

    expect((await tallied(server)).status).toBe(200);
  });
});
