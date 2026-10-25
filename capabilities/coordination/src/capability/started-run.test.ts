import {
  answeringLaterMs,
  answeringNowMs,
  asking,
  echo,
  noCalledDefinitions,
  recordingJournal,
} from '@on.auto/definitions/testing';
import { memoryLedger } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { callMarginMs } from '../runs/call-limits.ts';
import { playbookOn } from '../testing/playbook.ts';
import { recordingStarts, recordingWorkflows } from '../testing/recording-starts.ts';
import { acmeCaller } from '../testing/workflows.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-555555555552';

const flow = "document: { dsl: '1.0.3', namespace: acme, name: flow, version: '1.0.0' }\ndo: []\n";

const calling = [
  "document: { dsl: '1.0.3', namespace: acme, name: calling, version: '1.0.0' }",
  'do:',
  '  - greet: { call: run_definition, with: { type: echo, name: greet } }',
  '  - nested: { call: run_definition, with: { type: workflow, name: flow } }',
].join('\n');

describe('the run a run of a workflow starts', () => {
  it('is known by its playbook, its run, its version, its caller, its reaction depth and its lineage', async () => {
    const { starts, recording } = recordingStarts();
    const playbook = playbookOn(memoryLedger(), [recordingWorkflows(recording)]);
    await playbook.call(playbook.createDefinition, { type: 'workflow', name: 'flow', source: flow });

    await playbook.call(playbook.runDefinition, { type: 'workflow', name: 'flow', run_id: runId });

    expect(starts.map(({ attributes }) => attributes)).toMatchObject([
      {
        org: 'acme',
        playbook: 'alpha',
        run_id: runId,
        definition: { name: 'flow', version: 1 },
        caller: { id: 'acme-admin', org: 'acme', playbooks: '*', permissions: ['playbook:read', 'playbook:write'] },
        depth: 0,
        call_depth: 0,
        lineage: { correlation: runId },
      },
    ]);
  });
});

describe('the run a run of a workflow starts for a call or a trigger', () => {
  it('carries the call that started it and the trigger that started it, when it has them', async () => {
    const { starts, recording } = recordingStarts();
    const prepared = await Effect.runPromise(recordingWorkflows(recording).prepare(flow));
    const context = {
      id: runId,
      org: 'acme',
      playbook: 'alpha',
      caller: acmeCaller,
      definition: { name: 'flow', version: 1 },
      journal: recordingJournal(),
      lineage: { startId: 'start-1', correlationId: 'root-1' },
      depth: 1,
      callDepth: 1,
      calledBy: { run_id: 'r-0', reference: '/do/0/flow', run: 1 },
      trigger: { kind: 'event', reference: '/schedule/on' },
      ...noCalledDefinitions,
    } as const;

    await Effect.runPromise(prepared.run({}, context));

    expect(starts.map(({ attributes }) => attributes)).toMatchObject([
      {
        called_by: { run_id: 'r-0', reference: '/do/0/flow', run: 1 },
        trigger: { kind: 'event', reference: '/schedule/on' },
      },
    ]);
  });
});

describe('the calls of the run a run of a workflow starts', () => {
  it('waits for each call that names its definition no longer than that definition may run, with a minute more', async () => {
    const { starts, recording } = recordingStarts();
    const playbook = playbookOn(memoryLedger(), [recordingWorkflows(recording), echo]);
    await playbook.call(playbook.createDefinition, { type: 'echo', name: 'greet', source: '{"greeting": "Hello"}' });
    await playbook.call(playbook.createDefinition, { type: 'workflow', name: 'flow', source: flow });
    await playbook.call(playbook.createDefinition, { type: 'workflow', name: 'calling', source: calling });

    await playbook.call(playbook.runDefinition, { type: 'workflow', name: 'calling', run_id: runId });

    expect(starts.map(({ limits }) => limits)).toEqual([
      {
        mostDurationMs: 2_592_000_000,
        longestCallMs: 1000,
        longestCallMsByTask: { '/do/0/greet': 660_000, '/do/1/nested': 2_592_060_000 },
      },
    ]);
  });
});

const askingInTurn = [
  "document: { dsl: '1.0.3', namespace: acme, name: asking, version: '1.0.0' }",
  'do:',
  '  - now: { call: run_definition, with: { type: asking, name: approve, input: { now: true } } }',
  '  - later: { call: run_definition, with: { type: asking, name: approve, input: { campaign: Spring } } }',
  '  - plain: { call: run_definition, with: { type: asking, name: approve } }',
  "  - computed: { call: run_definition, with: { type: asking, name: approve, input: '${ $data }' } }",
  "  - inside: { call: run_definition, with: { type: asking, name: approve, input: { now: '${ $data.now }' } } }",
].join('\n');

describe('the calls of a workflow to a function whose runs last as long as their input says', () => {
  it('waits for each call as long as the call’s literal input may run, and as long as any input may otherwise', async () => {
    const { starts, recording } = recordingStarts();
    const playbook = playbookOn(memoryLedger(), [recordingWorkflows(recording), asking]);
    await playbook.call(playbook.createDefinition, { type: 'asking', name: 'approve', source: 'Approve the brief?' });
    await playbook.call(playbook.createDefinition, { type: 'workflow', name: 'asking', source: askingInTurn });

    await playbook.call(playbook.runDefinition, { type: 'workflow', name: 'asking', run_id: runId });

    expect(starts.map(({ limits }) => limits.longestCallMsByTask)).toEqual([
      {
        '/do/0/now': answeringNowMs + callMarginMs,
        '/do/1/later': answeringLaterMs + callMarginMs,
        '/do/2/plain': answeringLaterMs + callMarginMs,
        '/do/3/computed': answeringLaterMs + callMarginMs,
        '/do/4/inside': answeringLaterMs + callMarginMs,
      },
    ]);
  });
});
