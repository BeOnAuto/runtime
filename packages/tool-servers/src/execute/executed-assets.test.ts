import { Buffer } from 'node:buffer';

import { heldForATest, keptForATest } from '@on.auto/operations/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { patientTiming, playbookToolCalls, reportingAccess } from '../testing/index.ts';
import { fakeApiKey, serveFakeMcp, type FakeTool } from '../testing/served-fakes.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const save: FakeTool = {
  name: 'save',
  inputSchema: {
    type: 'object',
    properties: { path: { type: 'string' }, content: { type: 'string' } },
    required: ['path', 'content'],
  },
  answer: () => ({ content: [{ type: 'text', text: 'saved' }] }),
};

const notes = keptForATest('019a5b12-0000-7000-8000-000000000011', 'text/markdown', '# Minutes\nAll agreed.\n');

const ofAnotherPlaybook = keptForATest('019a5b12-0000-7000-8000-000000000012', 'text/plain', 'beta', {
  org: 'acme',
  playbook: 'beta',
});

const scan = keptForATest('019a5b12-0000-7000-8000-000000000013', 'application/pdf', Uint8Array.of(37, 80, 68, 70));

async function byHand(mostRequestBytes?: number) {
  const fake = await serveFakeMcp({ bearer: fakeApiKey, tools: [save] });
  closing.push(fake.close);
  const graph = { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' };
  const { access } = reportingAccess(
    { graph },
    {
      timing: patientTiming,
      environment: { GRAPH_API_KEY: fakeApiKey },
      assets: heldForATest([notes, ofAnotherPlaybook, scan]),
      ...(mostRequestBytes === undefined ? {} : { mostRequestBytes }),
    },
  );
  closing.push(access.close);
  const { call } = playbookToolCalls(access);
  return { fake, execute: (input: unknown) => call('execute_connection', input) };
}

describe('a call by hand that names an asset of the playbook', () => {
  it('sends the asset’s text where the tool takes text, as a run’s call would', async () => {
    const { fake, execute } = await byHand();

    const executed = await execute({
      server: 'graph',
      tool: 'save',
      arguments: { path: 'minutes.md', content: notes.reference },
    });

    expect(executed).toMatchObject({ status: 'succeeded', output: { outcome: 'result', text: 'saved' } });
    expect(fake.received()).toMatchObject([
      { tool: 'save', arguments: { path: 'minutes.md', content: Buffer.from(notes.content).toString('utf8') } },
    ]);
  });
});

describe('a call by hand that names an asset it cannot send', () => {
  it('is refused as invalid input, sending nothing, for an asset of another playbook or a file where the tool takes text', async () => {
    const { fake, execute } = await byHand();

    const refused = await Promise.all(
      [ofAnotherPlaybook, scan].map(({ reference }) =>
        execute({ server: 'graph', tool: 'save', arguments: { path: 'a.md', content: reference } }),
      ),
    );

    expect(refused).toMatchObject([
      {
        status: 'rejected',
        reason: 'invalid_input',
        issues: [
          {
            pointer: '/arguments/content',
            detail: `The argument /content names an asset that cannot be sent: No asset of this playbook has the id ${ofAnotherPlaybook.reference.id}; give an asset this playbook keeps, as the run that made it answered it`,
          },
        ],
      },
      {
        status: 'rejected',
        reason: 'invalid_input',
        issues: [
          {
            pointer: '/arguments/content',
            detail:
              'The argument /content is a file of application/pdf, and the save tool of graph takes text there; a tool takes a file where its schema says format: byte or contentEncoding: base64; send it to a tool that takes one',
          },
        ],
      },
    ]);
    expect(fake.received()).toEqual([]);
  });
});

describe('a call by hand that names an asset with other bytes or too large', () => {
  it('is refused where the asset is named with other bytes than the playbook keeps under its id', async () => {
    const { fake, execute } = await byHand();
    const guessed = { ...notes.reference, sha256: 'b'.repeat(64) };

    expect(
      await execute({ server: 'graph', tool: 'save', arguments: { path: 'a.md', content: guessed } }),
    ).toMatchObject({
      reason: 'invalid_input',
      detail: `The argument /content names an asset that cannot be sent: No asset of this playbook has the id ${notes.reference.id} with the SHA-256 ${'b'.repeat(64)}; give an asset this playbook keeps, as the run that made it answered it`,
    });
    expect(fake.received()).toEqual([]);
  });

  it('is refused where the asset’s text makes the call more than a call may send, with what to do instead', async () => {
    const { fake, execute } = await byHand(40);
    const executed = await execute({
      server: 'graph',
      tool: 'save',
      arguments: { path: 'a.md', content: notes.reference },
    });

    expect([executed, fake.received()]).toEqual([
      expect.objectContaining({
        reason: 'invalid_input',
        issues: [expect.objectContaining({ pointer: '/arguments' })],
      }),
      [],
    ]);
  });
});
