import type { CallerIdentity, Outcome, Succeeded } from '@on.auto/operations';
import { Schema } from 'effect';

import { ada, operationNamed, type Harness } from './harness.ts';

export const crm = {
  name: 'crm',
  type: 'mcp',
  entry: {
    url: 'https://crm.example.com/mcp',
    allowed: ['search'],
    playbooks: ['sales'],
  },
  credential: { kind: 'secret', name: 'Authorization', in: 'header' },
} as const;

export const crmWithTenant = {
  ...crm,
  entry: { ...crm.entry, headers: { 'X-Tenant': 'acme-eu' } },
} as const;

export const billing = {
  name: 'billing',
  type: 'openapi',
  entry: { document: 'https://billing.example.com/openapi.json', base_url: 'https://api.billing.example.com/v2' },
  credential: { kind: 'client_credentials', issuer: 'https://auth.billing.example.com', client_id: 'acme' },
} as const;

export const notes = {
  name: 'notes',
  type: 'mcp',
  entry: { url: 'https://notes.example.com/mcp' },
  credential: { kind: 'none' },
} as const;

const AddedSchema = Schema.Struct({
  status: Schema.Literal('succeeded'),
  output: Schema.Struct({
    id: Schema.String,
    connect: Schema.Struct({ url: Schema.String, expires_at: Schema.String }),
  }),
});

const LinkSchema = Schema.Struct({ token: Schema.String });

export interface Added {
  readonly id: string;
  readonly token: string;
  readonly url: string;
  readonly expiresAt: string;
}

const ListedSchema = Schema.Struct({
  output: Schema.Struct({ connections: Schema.Array(Schema.Struct({ name: Schema.String })) }),
});

const RejectedSchema = Schema.Struct({
  issues: Schema.Array(Schema.Struct({ pointer: Schema.String, detail: Schema.String })),
});

export async function lastFact(h: Harness): Promise<unknown> {
  return (await h.facts()).at(-1)?.data;
}

export function namesIn(outcome: Outcome<Succeeded>): readonly string[] {
  return Schema.decodeUnknownSync(ListedSchema)(outcome).output.connections.map(({ name }) => name);
}

export function issuesIn(
  outcome: Outcome<Succeeded>,
): readonly { readonly pointer: string; readonly detail: string }[] {
  return Schema.decodeUnknownSync(RejectedSchema)(outcome).issues;
}

export function adding(h: Harness, input: unknown, caller = ada): Promise<Outcome<Succeeded>> {
  return h.call(operationNamed(h.operations, 'add_connection'), caller, input);
}

export function statusesOf(h: Harness, inputs: readonly unknown[]): Promise<readonly string[]> {
  return inputs.reduce<Promise<readonly string[]>>(
    async (statuses, input) => [...(await statuses), (await adding(h, input)).status],
    Promise.resolve([]),
  );
}

function linkedIn(outcome: Outcome<Succeeded>): Added {
  const { output } = Schema.decodeUnknownSync(AddedSchema)(outcome);
  const { token } = Schema.decodeUnknownSync(LinkSchema)(Object.fromEntries(new URL(output.connect.url).searchParams));
  return {
    id: output.id,
    token,
    url: output.connect.url,
    expiresAt: output.connect.expires_at,
  };
}

interface Acting {
  readonly caller?: CallerIdentity;
  readonly at?: string;
}

export async function added(h: Harness, input: unknown = crm, { caller = ada, at }: Acting = {}): Promise<Added> {
  return linkedIn(await h.call(operationNamed(h.operations, 'add_connection'), caller, input, at));
}

export function reconnecting(h: Harness, id: string, at?: string): Promise<Outcome<Succeeded>> {
  return h.call(operationNamed(h.operations, 'reconnect_connection'), ada, { id }, at);
}

export async function reconnected(h: Harness, id: string, at?: string): Promise<Added> {
  return linkedIn(await reconnecting(h, id, at));
}
