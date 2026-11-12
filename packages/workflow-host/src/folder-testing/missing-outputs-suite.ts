import { describe, expect, it } from 'vitest';

import { keptAndTallied, successes, type FoldingSettingsOf } from './kept-output-views.ts';

function unavailableTests(settingsOf: FoldingSettingsOf): void {
  it('ends with nothing folded and no trouble, and folds the fact once the store answers', async () => {
    const projected = await keptAndTallied(settingsOf, true, successes);

    await projected.wakeUp();
    const whileDown = await projected.tallied();
    projected.up();
    await projected.wakeUp();
    await projected.wakeUp();

    expect([whileDown, await projected.tallied(), projected.troubles()]).toEqual([[0], [1], []]);
  });
}

function missingTests(settingsOf: FoldingSettingsOf): void {
  it('folds the fact with the output as its size and says the output is missing', async () => {
    const projected = await keptAndTallied(settingsOf, false, successes);
    projected.up();

    await projected.wakeUp();
    await projected.wakeUp();

    expect(await projected.tallied()).toEqual([1]);
    expect(projected.missing()).toMatchObject([
      { org: 'acme', playbook: 'alpha', type: 'run_succeeded', passedBy: 'views' },
    ]);
  });

  it('says it once, though the views start again and a new view of its type folds it again from the start', async () => {
    const projected = await keptAndTallied(settingsOf, false, successes);
    projected.up();
    await projected.wakeUp();
    await projected.wakeUp();

    await projected.defined('runs-again', { counts: 'run_succeeded', stallsOn: 'never' });
    const restarted = projected.restarted();
    await restarted();
    await restarted();
    await restarted();

    expect([await projected.tallied(), projected.missing().length]).toEqual([[1, 1], 1]);
  });

  it('says it at the first view of its type to fold it, though a view of another type passed over it before', async () => {
    const projected = await keptAndTallied(settingsOf, false, { counts: 'run_started' });
    projected.up();
    await projected.wakeUp();
    await projected.wakeUp();
    const beforeItsType = projected.missing().length;

    await projected.defined('successes', successes);
    const restarted = projected.restarted();
    await restarted();
    await restarted();
    await restarted();

    expect([beforeItsType, await projected.tallied(), projected.missing()]).toMatchObject([
      0,
      [1, 1],
      [{ type: 'run_succeeded', passedBy: 'views' }],
    ]);
  });
}

function rememberedByTheViewsAloneTests(settingsOf: FoldingSettingsOf): void {
  it('says it again when the only view of its type is made again by a new version and folds it again after the views start again, since no view of its type then holds a place past it', async () => {
    const projected = await keptAndTallied(settingsOf, false, successes);
    projected.up();
    await projected.wakeUp();
    await projected.wakeUp();

    await projected.defined('runs', { counts: 'run_succeeded', stallsOn: 'never' }, 2);
    const restarted = projected.restarted();
    await restarted();
    await restarted();
    await restarted();

    expect([await projected.tallied(), projected.missing().length]).toEqual([[1], 2]);
  });

  it('does not say it when a later view of its type folds it after it went missing, since an earlier view of its type folded it while it could be read', async () => {
    const projected = await keptAndTallied(settingsOf, true, successes);
    projected.up();
    await projected.wakeUp();
    await projected.wakeUp();

    projected.lost();
    await projected.defined('runs-again', { counts: 'run_succeeded', stallsOn: 'never' });
    await projected.wakeUp();
    await projected.wakeUp();
    await projected.wakeUp();

    expect([await projected.tallied(), projected.missing()]).toEqual([[1, 1], []]);
  });
}

export function missingOutputsSuite(settingsOf: FoldingSettingsOf): void {
  describe('a pass of the views over a fact whose kept output the content store cannot give just now', () => {
    unavailableTests(settingsOf);
  });

  describe('a pass of the views over a fact whose kept output is missing from its playbook’s content', () => {
    missingTests(settingsOf);
  });

  describe('a missing output the views remember only by where their views of its type stand', () => {
    rememberedByTheViewsAloneTests(settingsOf);
  });
}
