import type { Outcome } from '@on.auto/operations';
import { Effect } from 'effect';

import { added, crm, type Added } from './additions.ts';
import { ada, operationNamed, type Harness } from './harness.ts';
import { preparedOf, sourceOver } from './served-connections.ts';

export function giving(h: Harness, { id, token }: Added, value: string, at?: string): Promise<Outcome> {
  return h.call(operationNamed(h.operations, 'give_credential'), ada, { id, token, value }, at);
}

export async function connectedCrm(h: Harness): Promise<string> {
  const link = await added(h, crm);
  await giving(h, link, 'Bearer crm-key-0f3c9a71');
  return link.id;
}

export async function brokenCrm(h: Harness): Promise<string> {
  const id = await connectedCrm(h);
  await Effect.runPromise((await preparedOf(sourceOver(h), id)).refused);
  return id;
}
