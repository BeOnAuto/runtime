import type { Environment } from '@on.auto/config';
import { describe, expect, it } from 'vitest';

import { secretsKey } from '../testing/databases/secrets-key.ts';
import { readSettingsOf } from '../testing/settings/shipped-settings.ts';
import { type Settings } from './settings.ts';

function settingsOf(environment: Environment): Settings {
  return readSettingsOf({ SECRETS_KEY: secretsKey, ...environment });
}

function errorFrom(environment: Environment): string {
  try {
    settingsOf(environment);
  } catch (error) {
    return String(error);
  }
  return 'no error';
}

const rdsHost = 'ledger.c9akciq32.eu-west-1.rds.amazonaws.com';

const signedTokens = { DATABASE_CREDENTIALS: 'aws-iam' };

const refusedAs = 'InvalidSettingsError: The ledger settings are invalid.';

describe('the credentials of a ledger in PostgreSQL', () => {
  it('are the password in DATABASE_URL unless DATABASE_CREDENTIALS says otherwise', () => {
    expect(
      settingsOf({ DATABASE_URL: `postgresql://auto_runtime:a-password@${rdsHost}/playbooks` }).ledger,
    ).toMatchObject({ credentials: { kind: 'url' } });
    expect(
      settingsOf({
        DATABASE_URL: `postgresql://auto_runtime:a-password@${rdsHost}/playbooks`,
        DATABASE_CREDENTIALS: 'url',
      }).ledger,
    ).toMatchObject({ credentials: { kind: 'url' } });
  });

  it('are a token signed for the host, the port and the user of DATABASE_URL, in the region its RDS host names', () => {
    expect(
      settingsOf({ ...signedTokens, DATABASE_URL: `postgresql://auto%5Fruntime@${rdsHost}:5433/playbooks` }).ledger,
    ).toMatchObject({
      credentials: {
        kind: 'aws-iam',
        signedFor: { hostname: rdsHost, port: 5433, username: 'auto_runtime', region: 'eu-west-1' },
      },
    });
  });

  it("take the region of the database's RDS host over AWS_REGION, which the server's other AWS clients read", () => {
    expect(
      settingsOf({
        ...signedTokens,
        AWS_REGION: 'us-east-1',
        DATABASE_URL: `postgresql://auto_runtime@${rdsHost}/playbooks`,
      }).ledger,
    ).toMatchObject({ credentials: { signedFor: { port: 5432, region: 'eu-west-1' } } });
  });

  it('take AWS_REGION for a host that names no region, and an address as the driver reads it', () => {
    expect(
      settingsOf({
        ...signedTokens,
        AWS_REGION: 'eu-central-1',
        DATABASE_URL: 'postgresql://auto_runtime@[fd00::5]:6432/playbooks?sslmode=verify-full',
      }).ledger,
    ).toMatchObject({
      credentials: { signedFor: { hostname: 'fd00::5', port: 6432, username: 'auto_runtime', region: 'eu-central-1' } },
    });
  });
});

describe('credentials the server cannot use', () => {
  it.each(['password', 'AWS-IAM', 'iam', ' aws-iam'])(
    'stop the server from starting when DATABASE_CREDENTIALS is %j, naming the setting and its values',
    (value) => {
      expect(errorFrom({ DATABASE_CREDENTIALS: value })).toBe(
        `${refusedAs} DATABASE_CREDENTIALS: Expected url, the password in DATABASE_URL, or aws-iam`,
      );
    },
  );

  it('stop the server from starting when DATABASE_CREDENTIALS is aws-iam and no DATABASE_URL names a database', () => {
    expect(errorFrom({ ...signedTokens, LEDGER_FILE: '/data/ledger.db' })).toBe(
      `${refusedAs} DATABASE_CREDENTIALS: aws-iam signs the password of a PostgreSQL connection, so set DATABASE_URL`,
    );
  });

  it.each([
    `postgresql://auto_runtime:a-secret-password@${rdsHost}/playbooks`,
    `postgresql://auto_runtime@${rdsHost}/playbooks?password=a-secret-password`,
  ])('stop the server from starting when the URL holds a password beside aws-iam, never naming it: %s', (url) => {
    const error = errorFrom({ ...signedTokens, DATABASE_URL: url });

    expect(error).toBe(
      `${refusedAs} DATABASE_URL: With DATABASE_CREDENTIALS=aws-iam the password is a token signed for each connection, so the URL holds none`,
    );
    expect(error).not.toContain('a-secret-password');
  });

  it.each([`postgresql://${rdsHost}/playbooks`, `postgresql://%E0%A4%A@${rdsHost}/playbooks`])(
    'stop the server from starting when the URL names no user to sign the token for: %s',
    (url) => {
      expect(errorFrom({ ...signedTokens, DATABASE_URL: url })).toBe(
        `${refusedAs} DATABASE_URL: With DATABASE_CREDENTIALS=aws-iam the URL names the user the token is signed for, such as postgresql://user@host:5432/database`,
      );
    },
  );
});

describe('a URL the server cannot sign its connections for', () => {
  it.each(['disable', 'allow', 'prefer', 'require', 'verify-ca', 'no-verify'])(
    'stop the server from starting when the URL turns the verification of TLS down to sslmode=%s',
    (mode) => {
      expect(
        errorFrom({ ...signedTokens, DATABASE_URL: `postgresql://auto_runtime@${rdsHost}/playbooks?sslmode=${mode}` }),
      ).toBe(
        `${refusedAs} DATABASE_URL: With DATABASE_CREDENTIALS=aws-iam the connection verifies the database's certificate and host name, so sslmode is verify-full or left out`,
      );
    },
  );

  it.each(['sslrootcert=/certs/global-bundle.pem', 'ssl=0', 'sslcert=/certs/client.pem&sslkey=/certs/client.key'])(
    'stop the server from starting when the URL gives a TLS option, %s, naming where the authority goes',
    (option) => {
      const names = [...new URLSearchParams(option).keys()].join(', ');

      expect(
        errorFrom({ ...signedTokens, DATABASE_URL: `postgresql://auto_runtime@${rdsHost}/playbooks?${option}` }),
      ).toBe(
        `${refusedAs} DATABASE_URL: With DATABASE_CREDENTIALS=aws-iam the connection checks the database's certificate against the certificate authorities Node trusts, so the URL takes no ${names}; name the file of your authority's certificate in NODE_EXTRA_CA_CERTS instead`,
      );
    },
  );

  it('stop the server from starting when the URL gives the driver options a signed connection does not take', () => {
    expect(
      errorFrom({
        ...signedTokens,
        DATABASE_URL: `postgresql://auto_runtime@${rdsHost}/playbooks?sslmode=verify-full&application_name=runtime&options=-c%20search_path%3Dledger&application_name=again`,
      }),
    ).toBe(
      `${refusedAs} DATABASE_URL: With DATABASE_CREDENTIALS=aws-iam the connection is made from the user, host, port and database of the URL alone, so it takes no application_name, options`,
    );
  });

  it('stop the server from starting when neither AWS_REGION nor the host of the URL names a region', () => {
    expect(errorFrom({ ...signedTokens, DATABASE_URL: 'postgresql://auto_runtime@db.internal:5432/playbooks' })).toBe(
      `${refusedAs} AWS_REGION: With DATABASE_CREDENTIALS=aws-iam the token is signed for the database's region, which the host of DATABASE_URL does not name, so set AWS_REGION`,
    );
  });
});
