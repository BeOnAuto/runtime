import { createHash } from 'node:crypto';
import { request } from 'node:http';

import { Ledger, textOfContent } from '@on.auto/operations';
import { Effect, ManagedRuntime } from 'effect';

import { ledgerLayerFor } from '../composition/ledger-store.ts';
import { ledgerDatabaseOf } from '../database/ledger-database.ts';
import { readSettingsOf } from '../testing/settings/shipped-settings.ts';

const datasets = '/v1/orgs/acme/playbooks/alpha/datasets';

export interface Answer {
  readonly status: number;
  readonly body: unknown;
}

export function sha256Of(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export async function uploaded(origin: string, text: string, sha256 = sha256Of(text)): Promise<Answer> {
  const response = await fetch(`${origin}${datasets}/${sha256}`, {
    method: 'PUT',
    headers: { 'content-type': 'text/csv' },
    body: text,
  });
  return { status: response.status, body: await response.json() };
}

export function answeredBeforeTheBody(origin: string, headers: Readonly<Record<string, string>>): Promise<Answer> {
  return new Promise((resolve) => {
    const sent = request(`${origin}${datasets}/${sha256Of('')}`, { method: 'PUT', headers }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (piece: string) => {
        text += piece;
      });
      response.on('end', () => {
        sent.destroy();
        resolve({ status: Number(response.statusCode), body: JSON.parse(text) });
      });
    });
    sent.flushHeaders();
  });
}

export async function keptText(
  environment: Readonly<Record<string, string>>,
  sha256: string,
): Promise<string | undefined> {
  const settings = readSettingsOf(environment);
  const runtime = ManagedRuntime.make(ledgerLayerFor(settings, await ledgerDatabaseOf(settings)));
  try {
    const kept = await runtime.runPromise(
      Effect.flatMap(Ledger, ({ content }) => content.get({ org: 'acme', playbook: 'alpha' }, sha256)),
    );
    return kept === undefined ? undefined : await Effect.runPromise(textOfContent(kept));
  } finally {
    await runtime.dispose();
  }
}
