import type { Outcome, RegisteredPlainLanguage } from '@on.auto/operations';
import { Option, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ConnectionOperations } from '../operations/connection-operations.ts';
import { added, type Added } from '../testing/additions.ts';
import { allowedAt, finishingWith } from '../testing/gateways.ts';
import { ada, grace, operationNamed, type Harness } from '../testing/harness.ts';
import { connectedFiles, replacingFiles, replacingFilesBySignIn, type Replacing } from '../testing/replacements.ts';

const anyWords: unknown = expect.any(String);

const MovedSchema = Schema.Struct({
  output: Schema.Struct({
    id: Schema.String,
    connect: Schema.Struct({ url: Schema.String }),
  }),
});

function reconnecting(h: Harness, operations: ConnectionOperations, input: unknown, caller = ada): Promise<Outcome> {
  return h.call(operationNamed(operations, 'reconnect_connection'), caller, input);
}

function linkOf(outcome: Outcome): Added {
  const { output } = Schema.decodeUnknownSync(MovedSchema)(outcome);
  const token = Option.getOrThrow(Option.fromNullishOr(new URL(output.connect.url).searchParams.get('token')));
  return { id: output.id, token, url: output.connect.url };
}

function revocationsAt({ files }: Pick<Replacing, 'files'>): number {
  return files.heard().filter(({ path }) => path === '/revoke').length;
}

function outputOf(outcome: Outcome): unknown {
  return 'output' in outcome ? outcome.output : undefined;
}

function wordsOf(operations: ConnectionOperations): RegisteredPlainLanguage {
  const { registration } = operationNamed(operations, 'reconnect_connection');
  return Option.getOrThrow(
    Option.fromNullishOr('plainLanguage' in registration ? registration.plainLanguage : undefined),
  );
}

const kept = { playbooks: ['sales'], allowed: ['who_am_i'], record_content: false };

describe('a connection whose provider another provider replaces, reconnected', () => {
  it('is removed and added again from the provider that replaces it, under the same name and for the same playbooks, its credential forgotten and its tokens revoked, in one decision', async () => {
    const replacing = replacingFiles();
    const { h, after } = replacing;
    const old = await connectedFiles(replacing, { entry: kept });
    const before = (await h.facts()).length;

    const outcome = await reconnecting(h, after, { id: old.id });

    const moved = linkOf(outcome);
    expect(moved.id).not.toBe(old.id);
    expect(outcome).toMatchObject({
      status: 'succeeded',
      output: { name: 'files', provider: 'messages', status: 'pending', entry: kept, credential_ends_with: null },
    });
    expect((await h.facts()).slice(before).map(({ type, data }) => [type, data.connection])).toEqual([
      ['connection_removed', old.id],
      ['connection_added', moved.id],
      ['connection_link_issued', moved.id],
    ]);
    expect([revocationsAt(replacing), h.secrets.values().size]).toEqual([1, 0]);
  });

  it('then connects through the provider that replaces it, as any connection of that provider does', async () => {
    const replacing = replacingFiles();
    const { h, after, gateway } = replacing;
    const old = await connectedFiles(replacing);
    const moved = linkOf(await reconnecting(h, after, { id: old.id }));

    const finished = await finishingWith(h, moved, await allowedAt(h, gateway, moved));

    expect(finished).toMatchObject({ status: 'succeeded', output: { name: 'files', status: 'connected' } });
  });
});

describe('a connection whose provider another provider replaces, added again', () => {
  it('carries the values of the placeholders the provider that replaces it declares, and no other', async () => {
    const placeholder = { description: 'The team.', pattern: '^[a-z]+$', example: 'eu', required: false };
    const replacing = replacingFiles({
      files: {
        headers: { 'X-Team': '{team}', 'X-Region': '{region}' },
        placeholders: { team: placeholder, region: placeholder },
      },
      messages: { headers: { 'X-Team': '{team}' }, placeholders: { team: placeholder } },
    });
    const old = await connectedFiles(replacing, { placeholders: { team: 'eu', region: 'west' } });

    const outcome = await reconnecting(replacing.h, replacing.after, { id: old.id });

    expect(outcome).toMatchObject({ output: { placeholders: { team: 'eu' } } });
    expect(JSON.stringify(outcome)).not.toContain('west');
  });

  it('is pressed by another person than the one who added it, and the connection added again is theirs', async () => {
    const replacing = replacingFiles();
    const { h, after } = replacing;
    const old = await connectedFiles(replacing);

    const outcome = await reconnecting(h, after, { id: old.id }, grace);

    expect(outcome).toMatchObject({ status: 'succeeded', output: { name: 'files', added_by: { id: grace.id } } });
    expect(revocationsAt(replacing)).toBe(1);
  });

  it('is refused once removed, as any removed connection is', async () => {
    const replacing = replacingFiles();
    const { h, after } = replacing;
    const { id } = await added(h, { provider: 'files' });
    await h.call(operationNamed(h.operations, 'remove_connection'), ada, { id });

    expect(await reconnecting(h, after, { id })).toMatchObject({
      reason: 'conflict',
      detail: anyWords,
    });
  });
});

describe('the words of a connection added again from the provider that replaces its own', () => {
  it('ask the group of more it is given of the provider that replaces it, and say what happened', async () => {
    const { h, after } = replacingFilesBySignIn();
    const old = await connectedFiles({ h });
    const input = { id: old.id, more: 'share' };

    const outcome = await reconnecting(h, after, input);

    expect(outcome).toMatchObject({ output: { name: 'files', provider: 'shared-files' } });
    expect(wordsOf(after).outcome(outputOf(outcome), input)).toBe(
      'Added the connection “files” again from the provider “shared-files”, under its name and for the same playbooks; the connection before is removed and its credential forgotten. Show the person a link named “Approve the Shared files connection”, never its address. On that page they approve it and give its credential where it takes one. The link asks them to allow “share” as well: Share your files with other people.',
    );
  });

  it('say that it was added again, where it was given no group of more', async () => {
    const replacing = replacingFiles();
    const old = await connectedFiles(replacing);
    const input = { id: old.id };

    const outcome = await reconnecting(replacing.h, replacing.after, input);

    expect(wordsOf(replacing.after).outcome(outputOf(outcome), input)).toMatch(
      /^Added the connection “files” again from the provider “messages”, under its name and for the same playbooks; the connection before is removed and its credential forgotten\. Show the person a link named “[^”]+”, never its address\. On that page they approve it and [^.]+\.$/u,
    );
  });
});
