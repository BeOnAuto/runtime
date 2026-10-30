import { approvalDocument } from '@on.auto/interaction/testing';
import { weeklyOrdersWith } from '@on.auto/prediction/testing';
import { describe, expect, it, onTestFinished } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const versionApproval = [
  '---',
  'description: Ask the owner to approve a version of a prediction function',
  'to: owner',
  'expires: P2D',
  'input:',
  '  schema:',
  '    type: object',
  '    required: [function, version, card]',
  '    properties:',
  '      function: { type: string }',
  '      version: { type: integer }',
  '      card: { type: object }',
  'output:',
  '  schema:',
  '    type: object',
  '    required: [decision]',
  '    properties:',
  '      decision: { type: string, enum: [approve, reject] }',
  '      note: { type: string }',
  '---',
  'Approve version {{ input.version }} of {{ input.function }}?',
].join('\n');

const buildSending = [
  '---',
  'description: Send a build of a prediction function to its trainer',
  'to: trainer',
  'expires: P7D',
  'input:',
  '  schema:',
  '    type: object',
  '    required: [build]',
  '    properties:',
  '      build: { type: object }',
  'output:',
  '  schema:',
  '    type: object',
  '    required: [candidates]',
  '    properties:',
  '      candidates: { type: array, items: { type: string } }',
  '---',
  'A build is waiting for its trainer.',
].join('\n');

function calling(approver: string, sender: string): string {
  return weeklyOrdersWith(
    ['  activate: automatic', `  activate:\n    approved: ${approver}`],
    ['  expires: P7D', `  expires: P7D\n  through: ${sender}`],
  );
}

async function serving(): Promise<ReasoningServer> {
  const server = await servingReasoning([]);
  onTestFinished(server.stop);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  const saving = (name: string, source: string) =>
    server.call('POST', `${alpha}/definitions/interaction`, { body: { name, source } });
  await saving('version-approval', versionApproval);
  await saving('build-sending', buildSending);
  await saving('campaign-approval', approvalDocument());
  return server;
}

function saved(server: ReasoningServer, source: string) {
  return server.call('POST', `${alpha}/definitions/prediction`, { body: { name: 'weekly-orders', source } });
}

describe('the interaction functions a prediction function names', () => {
  it('are saved first, an approver taking a version and answering a decision, and a sender taking a build and answering candidates', async () => {
    const server = await serving();

    expect(await saved(server, calling('version-approval', 'build-sending'))).toMatchObject({ status: 201 });
  });

  it('refuse the prediction function at their lines when one does not fit what it is named for, or is not saved', async () => {
    const server = await serving();

    const refused = await saved(server, calling('campaign-approval', 'unsaved'));

    expect(refused).toMatchObject({
      status: 422,
      body: {
        reason: 'invalid_input',
        errors: [
          {
            pointer: '/source',
            detail:
              'Line 23, /evaluation/activate/approved: The input schema of campaign-approval does not take { function, version, card }, which an approval is asked with: /campaign: Missing key; /owner: Missing key',
          },
          {
            pointer: '/source',
            detail:
              'Line 23, /evaluation/activate/approved: The output schema of campaign-approval, the function that approves a version, is not an object whose one required property decision is approve or reject',
          },
          {
            pointer: '/source',
            detail:
              'Line 26, /source/through: unsaved is not an active interaction function of this playbook; save it first, or name one that is',
          },
        ],
      },
    });
  });
});
