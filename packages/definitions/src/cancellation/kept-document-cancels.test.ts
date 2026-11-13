import { PayloadOffloading, mostInlinePayloadBytes } from '@on.auto/operations/payloads';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineCapability, runCanceller, type CancelOfALiveAttempt, type CancelRequest } from '../index.ts';
import type { RunCommand } from '../runs/run-commands.ts';
import { runDecider } from '../runs/run-decider.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { firstMoment, harness, toPlaybook } from '../testing/harness.ts';
import { watchedStore } from '../testing/kept-payloads.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-0000000000d2';

const address = { org: 'acme', playbook: 'alpha', id: runId };

const stream = `playbook/acme/alpha/runs/${runId}`;

const lineage = { causationId: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', correlationId: runId };

const longestCallMs = 70_000;

const deadline: CancelRequest = { kind: 'deadline', reason: 'The step that waited for this run ran out of time' };

const posting = defineCapability({
  type: 'system-call',
  title: 'System call',
  guide: { name: 'system-call' },
  noun: { one: 'system call', other: 'system calls' },
  describeOutput: () => 'It called a system.',
  mediaType: 'text/plain',
  parse: (source: string) => Effect.succeed(source),
  summarize: () => ({}),
  run: () => Effect.never,
  reachesOutside: true,
  mayChangeOutside: true,
  callsTools: () => true,
  longestRunOf: () => longestCallMs,
});

const operations = definitionOperationsFor([posting]);

const toAlpha = toPlaybook('acme', 'alpha');

const acted = { runId, by: 'acme-admin', at: firstMoment };

const started: RunCommand = {
  type: 'start',
  definition_type: 'system-call',
  name: 'post',
  input: {},
  started_by: { id: acmeAdmin.id, name: acmeAdmin.name },
  definition_version: 1,
  calls_tools: true,
  ...acted,
};

const calling: RunCommand = {
  type: 'call',
  fact: {
    type: 'tool_call_started',
    data: { call_id: 'toolu_1', server: 'slack', tool: 'post_message', arguments_bytes: 2 },
  },
  ...acted,
};

const longPost = `Post to the channel the playbook names. ${'and more '.repeat(Math.ceil(mostInlinePayloadBytes / 9))}`;

async function cancelledLate({ readable }: { readonly readable: boolean }) {
  const watched = watchedStore();
  const definitions = harness(undefined, watched.store);
  const { service } = definitions.ledger;
  await definitions.run(
    definitions
      .dispatch(
        operations.createDefinition,
        toAlpha(acmeAdmin, { type: 'system-call', name: 'post', source: longPost }),
      )
      .pipe(Effect.provideService(PayloadOffloading, true)),
  );
  await definitions.run(
    Effect.orDie(
      Effect.andThen(service.execute(stream, runDecider, started), service.execute(stream, runDecider, calling)),
    ),
  );
  if (!readable) {
    watched.fail();
  }
  const lookedAtAgain: CancelOfALiveAttempt[] = [];
  const lookAgain = (cancel: CancelOfALiveAttempt) => Effect.sync(() => lookedAtAgain.push(cancel));
  const at = new Date(Date.parse(firstMoment) + longestCallMs + 1).toISOString();
  await definitions.run(Effect.orDie(runCanceller(service, [posting], lookAgain)(address, deadline, lineage)), at);
  const read = await definitions.call(operations.getRun, toAlpha(acmeAdmin, { run_id: runId }), at);
  return { lookedAtAgain, read };
}

describe('a cancel its caller makes of a run within its call whose document its playbook keeps outside its facts', () => {
  it('judges the attempt by the bound the document it reads gives, ending the run whose attempt died', async () => {
    const { read } = await cancelledLate({ readable: true });

    expect(read).toMatchObject({
      output: { status: 'rejected', rejection: { reason: 'cancelled', kind: 'deadline' } },
    });
  });

  it('records the cancel alone where the document cannot be read, judging no attempt by a bound it cannot know', async () => {
    const { read, lookedAtAgain } = await cancelledLate({ readable: false });

    expect([read, lookedAtAgain]).toMatchObject([{ status: 'succeeded', output: { status: 'started' } }, []]);
  });
});
