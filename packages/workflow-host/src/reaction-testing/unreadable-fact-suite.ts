import { messageIdOf } from '@on.auto/operations';
import { PayloadOffloading } from '@on.auto/operations/payloads';
import { Context } from 'effect';
import { expect, it } from 'vitest';

import type { SettingsOf } from '../testing/host-files.ts';
import { until } from '../testing/until.ts';
import {
  causesOf,
  heldUntil,
  holdReaching,
  holdStateOf,
  notesOf,
  notesReaching,
  type Holding,
} from './followed-rows.ts';
import { movedClock } from './moved-clock.ts';
import { alpha, at, definitionRecorded, eventTrigger, published, recorded } from './playbook-writes.ts';
import { reactingHost } from './reacting-host.ts';

const startedAt = Date.parse(at) + 1000;

async function unreadableBefore(settingsOf: SettingsOf, keptOutside: boolean): Promise<Holding> {
  const clock = movedClock(startedAt);
  const reacting = await reactingHost({
    settings: await settingsOf(),
    clock,
    context: Context.make(PayloadOffloading, keptOutside),
  });
  const { store } = reacting.database;
  await definitionRecorded(store, {
    name: 'watch',
    version: 1,
    triggers: [eventTrigger({ type: 'com.acme.sentinel' }, { type: 'run_started' })],
  });
  await recorded(store, `${alpha}runs/r-bad`, { type: 'run_started', data: { input: {}, calls_tools: 7 } });
  await published(store, { id: 's1', type: 'com.acme.sentinel' });
  return { reacting, clock };
}

function heldWhileKeptOutside(settingsOf: SettingsOf) {
  it('holds the playbook at a fact this release cannot read while payloads are kept outside, said at once, never counted and never passed', async () => {
    const holding = await unreadableBefore(settingsOf, true);

    const first = await holdReaching(holding, (state) => state.holds === 1);
    holding.clock.moveTo(heldUntil(first));
    const second = await holdReaching(holding, (state) => state.holds === 2);

    expect(second).toMatchObject({ held_since: startedAt, held_for: 'unreadable', attempts: 0 });
    expect(causesOf(holding)).toEqual([]);
    const tries = await notesReaching(holding, 'content_hold', 2);
    expect(notesOf(holding, 'fact_unreadable')).toEqual([
      {
        kind: 'fact_unreadable',
        org: 'acme',
        playbook: 'alpha',
        recordId: messageIdOf(`${alpha}runs/r-bad`, 1),
        type: 'run_started',
      },
    ]);
    expect(tries).toMatchObject([
      { heldFor: 'unreadable', holds: 1 },
      { heldFor: 'unreadable', holds: 2 },
    ]);
    expect(notesOf(holding, 'record_unreadable')).toEqual([]);
  });
}

function passedWhileKeptInline(settingsOf: SettingsOf) {
  it('passes a fact this release cannot read over, said, as before, while payloads are kept inline', async () => {
    const holding = await unreadableBefore(settingsOf, false);

    const started = await until(
      () => Promise.resolve(causesOf(holding)),
      (causes) => causes.length === 1,
    );

    expect(started).toEqual([messageIdOf(`${alpha}events/s1`, 1)]);
    expect(await holdStateOf(holding)).toMatchObject({ held_until: null, holds: 0, held_for: null });
    expect(notesOf(holding, 'record_unreadable')).toMatchObject([{ type: 'run_started' }]);
  });
}

function passedWhenItsTypeIsUnknown(settingsOf: SettingsOf) {
  it('passes a definition record of a type it does not know over, said, while payloads are kept outside', async () => {
    const clock = movedClock(startedAt);
    const reacting = await reactingHost({
      settings: await settingsOf(),
      clock,
      context: Context.make(PayloadOffloading, true),
    });
    const holding: Holding = { reacting, clock };
    const { store } = reacting.database;
    await definitionRecorded(store, {
      name: 'watch',
      version: 1,
      triggers: [eventTrigger({ type: 'com.acme.sentinel' })],
    });
    await recorded(
      store,
      `${alpha}definitions/workflow`,
      { type: 'definition_archived', data: {} },
      { by: 'acme-admin', at, definitionType: 'workflow', definitionName: 'watch', definitionVersion: 1 },
    );
    await published(store, { id: 's1', type: 'com.acme.sentinel' });

    const started = await until(
      () => Promise.resolve(causesOf(holding)),
      (causes) => causes.length === 1,
    );

    expect(started).toEqual([messageIdOf(`${alpha}events/s1`, 1)]);
    expect(await holdStateOf(holding)).toMatchObject({ held_until: null, holds: 0 });
    expect(notesOf(holding, 'record_unreadable')).toMatchObject([{ type: 'definition_archived' }]);
  });
}

export function unreadableFactSuite(settingsOf: SettingsOf): void {
  heldWhileKeptOutside(settingsOf);
  passedWhileKeptInline(settingsOf);
  passedWhenItsTypeIsUnknown(settingsOf);
}
