import { programPool } from '@on.auto/workflow-engine/dsl';
import { Effect, Exit } from 'effect';
import { afterAll, describe, expect, it } from 'vitest';

import { documentedPage, workflowWithData, workflowWithPage } from '../testing/pages.ts';
import { measuredPoolSettings } from '../testing/read-on-disk.ts';
import { checkingWithin } from '../testing/time/patient-checks.ts';
import { pageCheckOn } from './page-content.ts';

const pool = programPool({ workers: 1, heapMegabytes: 256, ...measuredPoolSettings });

afterAll(() => pool.close());

const checkPage = pageCheckOn(checkingWithin(pool));

function checking(source: string) {
  return Effect.map(checkPage(source, 'workflow'), (content) => content?.stripped ?? {});
}

function checked(source: string) {
  return Effect.runPromiseExit(checking(source));
}

function refusals(source: string) {
  return Effect.runPromise(Effect.flip(checking(source)));
}

function returning(views: string): string {
  return workflowWithData({ module: `export function fold(view: View, event: Event): View {\n  return ${views};\n}` });
}

describe('the check of a page’s module when it is saved', () => {
  it('passes the documented page, whose fold reads its views as their shapes, and keeps the module without its types', async () => {
    const { module = '' } = await Effect.runPromise(checking(`do: []\n${documentedPage}`));

    expect(module.split('\n')[0]).toMatch(/^export function fold\(view\s+, event\s+\)\s+\{$/u);
  });

  it('needs no check for a page without data', async () => {
    expect(await checked(workflowWithPage())).toEqual(Exit.succeed({}));
  });

  it('refuses a view that data.views does not declare, and a value of another shape, with the line in the page', async () => {
    expect(JSON.stringify(await refusals(returning('{ by_week: { lines: [] } }')))).toContain(
      "Line 13: Object literal may only specify known properties, and 'by_week' does not exist in type 'View'.",
    );
    expect(
      JSON.stringify(await refusals(returning("{ by_day: { values: [{ name: 'Posts', value: 1 }] } }"))),
    ).toContain(
      "Line 13: Object literal may only specify known properties, and 'values' does not exist in type 'Series'.",
    );
  });

  it('refuses a module that does not export fold', async () => {
    expect(
      JSON.stringify(
        await refusals(workflowWithData({ module: 'export function folding(view: View): View {\n  return view;\n}' })),
      ),
    ).toContain('Line 12: The program is a module that exports a function fold(view: View, event: Event): View');
  });

  it('refuses a filter expression that reads more than the data of its event, with its line', async () => {
    const reading = workflowWithData().replace(
      '        subject: workflow/morning-social-content',
      "        data: '${ $data.output != input }'",
    );

    expect(await refusals(reading)).toMatchObject({
      issues: [{ pointer: '/source', detail: "Line 8, /page/data/source/events/0/data: Cannot find name 'input'." }],
    });
  });
});
