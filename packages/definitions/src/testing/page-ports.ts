import type { ProgramPool } from '@on.auto/workflow-engine/dsl';
import { Effect } from 'effect';

import type { Capability } from '../capability/capability.ts';
import type { KeptViewState, KeptViews } from '../capability/view-standing.ts';
import { defineGetRun } from '../operations/get-run.ts';
import { makePageAdapter } from '../page/page-adapter.ts';
import { defineRenderPage } from '../page/render-page.ts';
import { echo } from './capabilities/echo.ts';
import { definitionOperationsFor } from './definition-operations.ts';

export const checkingNothing: Pick<ProgramPool, 'check'> = {
  check: () => Promise.resolve({ ran: 'checked', issues: [], stripped: { expressions: [] }, milliseconds: 0 }),
};

export const keepingNoViews: KeptViews = { viewOf: () => Effect.undefined, newestRecordAt: () => Effect.undefined };

export function keepingTheViews(kept: KeptViewState): KeptViews {
  return { viewOf: () => Effect.succeed(kept), newestRecordAt: () => Effect.succeed('2026-11-01T09:00:00.000Z') };
}

function echoing(type: string): Capability {
  return { ...echo, type };
}

export function pageOperationsOver(views: KeptViews) {
  const capabilities = [echoing('workflow'), echoing('reasoning'), makePageAdapter({ pool: checkingNothing, views })];
  return {
    ...definitionOperationsFor(capabilities),
    getRun: defineGetRun(capabilities),
    renderPage: defineRenderPage(capabilities),
  };
}

export const pageOperations = pageOperationsOver(keepingNoViews);
