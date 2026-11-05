import { Buffer } from 'node:buffer';

import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { RunImage } from '../steps/kept-content.ts';
import { runContext } from '../testing/reasoning-runs.ts';
import { imagesKeptOn } from './tool-images.ts';

describe('the images a run keeps', () => {
  it('are each kept for the run, by its caller, with what the call was, and answer the id of their asset', async () => {
    const run = runContext();
    const kept: RunImage[] = [];
    const call = { call_id: 'toolu_01', server: 'browser', tool: 'browser_take_screenshot' };
    const keep = imagesKeptOn(
      (image) =>
        Effect.sync(() => {
          kept.push(image);
          return `asset-${kept.length}`;
        }),
      run,
    );

    expect(await keep(Buffer.from('a screenshot'), call)).toBe('asset-1');
    expect(kept).toEqual([
      {
        playbook: { org: 'acme', playbook: 'alpha' },
        bytes: Buffer.from('a screenshot'),
        call,
        context: {
          by: 'acme-admin',
          runId: run.id,
          definitionType: 'reasoning',
          definitionName: 'summary',
          definitionVersion: 1,
        },
        lineage: { causationId: run.lineage.startId, correlationId: run.lineage.correlationId },
      },
    ]);
  });
});
