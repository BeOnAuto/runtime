import { Struct } from 'effect';

import { isJson, isList, isObject, type Json, type JsonObject } from '../dsl/json.ts';
import type { FoldAnswerSchema, FoldJob } from '../jobs/fold-messages.ts';
import { foldPage, type FoldHost, type FoldingView, type FoldPage, type FoldedPage } from './fold-page.ts';

export type FoldAnswerData = typeof FoldAnswerSchema.Encoded;

const unreadable: FoldAnswerData = { ran: 'unreadable' };

function jsonIn(text: string): Json | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return isJson(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function objectsIn(value: Json | undefined): readonly JsonObject[] | undefined {
  return isList(value) && value.every((item) => isObject(item)) ? value.filter((item) => isObject(item)) : undefined;
}

function viewOf({ view, ...rest }: FoldJob['views'][number]): FoldingView | undefined {
  const folded = jsonIn(view);
  return folded === undefined ? undefined : { ...rest, view: folded };
}

function pageOf({ events, views, ...rest }: FoldJob): FoldPage | undefined {
  const read = objectsIn(jsonIn(events));
  const known = views.map((view) => viewOf(view)).filter((view) => view !== undefined);
  return read === undefined || known.length < views.length ? undefined : { ...rest, events: read, views: known };
}

function jobOfThePage({ events, views, ...rest }: FoldPage): FoldJob {
  return {
    ...rest,
    events: JSON.stringify(events),
    views: views.map(({ view, ...each }) => ({ ...each, view: JSON.stringify(view) })),
  };
}

interface RequestedPage extends FoldPage {
  readonly waitMs?: number;
  readonly deadlineMs?: number;
  readonly worker?: unknown;
}

export function foldPageData(request: RequestedPage): FoldJob {
  return jobOfThePage(Struct.omit(request, ['waitMs', 'deadlineMs', 'worker']));
}

function answerFrom({ early, views }: FoldedPage): FoldAnswerData {
  return {
    ran: 'folded',
    early,
    views: views.map(({ view, ...rest }) => ({ ...rest, view: JSON.stringify(view) })),
  };
}

export function foldAnswerOf(request: FoldJob, host: FoldHost): FoldAnswerData {
  const page = pageOf(request);
  return page === undefined ? unreadable : answerFrom(foldPage(page, host));
}
