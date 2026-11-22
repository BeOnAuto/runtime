import type { CallerIdentity, Outcome } from '@on.auto/operations';
import { Option, Schema } from 'effect';

import type { ConnectionOperations } from '../operations/connection-operations.ts';
import type { ConnectionStarts } from '../policy/connection-starts.ts';
import type { Added } from './additions.ts';
import { operationNamed, type Harness } from './harness.ts';
import { connectedFiles, replacingFiles, type Replacing } from './replacements.ts';

const AddedAgainSchema = Schema.Struct({
  output: Schema.Struct({
    id: Schema.String,
    connect: Schema.Struct({ url: Schema.String }),
  }),
});

const StartedSchema = Schema.Struct({ output: Schema.Struct({ authorize: Schema.Struct({ url: Schema.String }) }) });

interface Pressing extends Replacing {
  readonly ops: ConnectionOperations;
  readonly old: Added;
}

export async function pressingWith(starts: ConnectionStarts): Promise<Pressing> {
  const replacing = replacingFiles();
  const old = await connectedFiles(replacing, { entry: { playbooks: ['sales'] } });
  return { ...replacing, old, ops: replacing.h.operationsWith({ providers: replacing.providers, starts }) };
}

export function pressed({ h, ops }: Pick<Pressing, 'h' | 'ops'>, id: string, caller: CallerIdentity): Promise<Outcome> {
  return h.call(operationNamed(ops, 'reconnect_connection'), caller, { id });
}

export function linkOf(outcome: Outcome): Added {
  const { output } = Schema.decodeUnknownSync(AddedAgainSchema)(outcome);
  const token = Option.getOrThrow(Option.fromNullishOr(new URL(output.connect.url).searchParams.get('token')));
  return { id: output.id, token, url: output.connect.url };
}

export function startingAs(
  { h, ops }: Pick<Pressing, 'h' | 'ops'>,
  { id, token }: Added,
  caller: CallerIdentity,
): Promise<Outcome> {
  return h.call(operationNamed(ops, 'start'), caller, { id, token });
}

export async function connectedAs(pressing: Pressing, link: Added, caller: CallerIdentity): Promise<Outcome> {
  const { output } = Schema.decodeUnknownSync(StartedSchema)(await startingAs(pressing, link, caller));
  const returned = pressing.gateway.allow(output.authorize.url);
  return pressing.h.call(operationNamed(pressing.ops, 'finish'), caller, {
    id: link.id,
    token: link.token,
    ...returned,
  });
}

export function revocationsAt({ files }: Pick<Replacing, 'files'>): number {
  return files.heard().filter(({ path }) => path === '/revoke').length;
}

export async function standingOf({ h, files }: Pick<Replacing, 'h' | 'files'>) {
  return { facts: await h.facts(), revoked: revocationsAt({ files }), kept: [...h.secrets.values()] };
}

export async function changesSince(h: Harness, from: number) {
  return (await h.facts()).slice(from).map(({ type, data }) => [type, data.connection] as const);
}
