import type { Schema } from 'effect';

import { recordOf } from '../shapes/shape-values.ts';
import type { RenderClock } from '../template/render-clock.ts';
import type { ParsedTemplate } from '../template/template-parsing.ts';
import type { PageViews } from './page-document.ts';
import { shown } from './rendered-blocks.ts';

interface RunRejectionShown {
  readonly reason: string;
  readonly kind?: string;
  readonly detail?: string;
}

export type RunShown =
  | {
      readonly status: 'started' | 'succeeded';
      readonly output: Schema.Json;
      readonly started: string;
      readonly ended: string | null;
      readonly version: number;
    }
  | { readonly status: 'rejected'; readonly rejection: RunRejectionShown }
  | { readonly status: 'failed' };

export interface SubjectShown {
  readonly type: string;
  readonly name: string;
  readonly description: string | null;
  readonly version: number | null;
}

export interface ReadMoment {
  readonly today: string;
  readonly now: string;
  readonly clock: RenderClock;
}

export type ViewsShown =
  | { readonly state: 'live'; readonly views: Schema.Json }
  | { readonly state: 'building' }
  | { readonly state: 'stalled' }
  | { readonly state: 'out_of_reach' };

export const viewsBeingBuilt = "Building this page's figures from the playbook's history…";

export const viewsStalled =
  'The figures stopped updating because the page could not process an event. Correct the page to continue.';

export const viewsOutOfReach = "Could not work out this page's figures as they stood when this run ended.";

export const runFailed = 'The run failed.';

function subjectVariables({ type, name, description, version }: SubjectShown): Schema.JsonObject {
  return { type, name, description, version };
}

function rejectedWords({ reason, kind, detail }: RunRejectionShown): string {
  const sentence = `The run was rejected as ${reason}${kind === undefined ? '' : `, ${kind}`}.`;
  return detail === undefined ? sentence : `${sentence} ${detail}`;
}

export function resultShown(parsed: ParsedTemplate, run: RunShown, subject: SubjectShown, moment: ReadMoment): string {
  if (run.status === 'failed') {
    return runFailed;
  }
  if (run.status === 'rejected') {
    return rejectedWords(run.rejection);
  }
  const variables = {
    output: run.output,
    run: { status: run.status, started: run.started, ended: run.ended, version: run.version },
    subject: subjectVariables(subject),
    today: moment.today,
    now: moment.now,
  };
  return shown(parsed, { variables, clock: moment.clock, stopped: 'Could not display this run:' });
}

function viewsOf(kept: Schema.Json, declared: PageViews): Schema.JsonObject {
  const given = Object.entries(recordOf(kept));
  return Object.fromEntries(
    Object.keys(declared).map((name) => [
      name,
      given.find(([each]: readonly [string, Schema.Json]) => each === name)?.[1] ?? null,
    ]),
  );
}

export function runsShown(
  parsed: ParsedTemplate,
  views: ViewsShown,
  { declared, subject }: { readonly declared: PageViews; readonly subject: SubjectShown },
  moment: ReadMoment,
): string {
  if (views.state === 'building') {
    return viewsBeingBuilt;
  }
  if (views.state === 'stalled') {
    return viewsStalled;
  }
  if (views.state === 'out_of_reach') {
    return viewsOutOfReach;
  }
  const variables = {
    views: viewsOf(views.views, declared),
    subject: subjectVariables(subject),
    today: moment.today,
    now: moment.now,
  };
  return shown(parsed, { variables, clock: moment.clock, stopped: 'Could not display this page’s figures:' });
}
