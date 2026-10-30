import { Array } from 'effect';

import { jsonOfText, textField, type Json, type JsonObject } from '../dsl/json.ts';
import { mostIssueBytes, textWithin, utf8BytesWithin } from '../programs/byte-sizes.ts';
import { foldingUnitOf, type Fold } from '../programs/kept-contexts.ts';
import type { Evaluation, ProgramFailure, ProgramRun } from '../programs/program-run.ts';
import type { SandboxInstance } from '../programs/sandbox-session.ts';
import { matchingOf, preparedFilters, type PreparedFilter, type Stopped } from './fold-filters.ts';

export type StallKind = 'raised' | 'work' | 'memory' | 'unfit' | 'size' | 'schema' | 'refused';

export interface FoldStall {
  readonly at: number;
  readonly kind: StallKind;
  readonly message: string;
  readonly line: number | null;
}

export interface FoldingView {
  readonly fold: string;
  readonly filters: readonly JsonObject[];
  readonly view: Json;
  readonly schema?: JsonObject;
  readonly events: readonly number[];
}

export interface FoldPage {
  readonly events: readonly JsonObject[];
  readonly views: readonly FoldingView[];
  readonly budget: number;
  readonly memoryBytes: number;
  readonly stackBytes: number;
  readonly foldDeadlineMs: number;
  readonly pageBudgetMs: number;
  readonly mostViewBytes: number;
}

export interface FoldedView {
  readonly view: Json;
  readonly folded: number;
  readonly lastFolded: number;
  readonly through: number;
  readonly work: number;
  readonly stall?: FoldStall;
  readonly overtime?: number;
}

export interface FoldedPage {
  readonly early: boolean;
  readonly views: readonly FoldedView[];
}

export type ViewCheck = (view: Json) => string | undefined;

export interface FoldHost {
  readonly now: () => number;
  readonly folding: (event: number, view: number) => void;
  readonly checkOf: (schema: JsonObject) => ViewCheck;
  readonly instances: readonly SandboxInstance[];
}

type Ready = { readonly fold: Fold; readonly filters: readonly PreparedFilter[] } | { readonly failed: ProgramFailure };

interface Prepared {
  readonly ready: Ready;
  readonly check: ViewCheck | undefined;
  readonly considered: ReadonlySet<number>;
  readonly close: () => void;
}

interface Folding {
  readonly prepared: Prepared;
  readonly state: FoldedView;
}

type Step = { readonly view: Json } | { readonly stall: Omit<FoldStall, 'at'> } | { readonly overtime: true };

interface Folded {
  readonly step: Step;
  readonly work: number;
}

interface PlacedEvent {
  readonly at: number;
  readonly event: JsonObject;
}

interface Turns {
  readonly page: FoldPage;
  readonly host: FoldHost;
  readonly firstFoldAt: () => number | undefined;
  readonly take: () => void;
}

function stalled(kind: StallKind, message: string, line: number | null = null): Step {
  return { stall: { kind, message: textWithin(message, mostIssueBytes), line } };
}

function readyOf(
  [view, instance]: readonly [FoldingView, SandboxInstance],
  page: FoldPage,
  host: FoldHost,
): Pick<Prepared, 'ready' | 'close'> {
  const evaluation: Evaluation = {
    budget: Number.POSITIVE_INFINITY,
    deadlineAt: host.now() + page.foldDeadlineMs,
    moment: 0,
  };
  const unit = foldingUnitOf(
    instance,
    { stackBytes: page.stackBytes, mostAnswerBytes: page.mostViewBytes, clock: host.now },
    { fold: view.fold, view: JSON.stringify(view.view) },
    evaluation,
  );
  if ('refused' in unit) {
    return { ready: { failed: unit.refused }, close: unit.close };
  }
  const filters = preparedFilters(view.filters, unit.define);
  const frozen = unit.freeze();
  return { ready: frozen === undefined ? { fold: unit.fold, filters } : { failed: frozen }, close: unit.close };
}

function foldingOf(placed: readonly [FoldingView, SandboxInstance], page: FoldPage, host: FoldHost): Folding {
  const [view] = placed;
  return {
    prepared: {
      ...readyOf(placed, page, host),
      check: view.schema === undefined ? undefined : host.checkOf(view.schema),
      considered: new Set(view.events),
    },
    state: { view: view.view, folded: 0, lastFolded: -1, through: -1, work: 0 },
  };
}

function tooLarge(page: FoldPage): Step {
  return stalled('size', `The view takes more than the ${page.mostViewBytes} bytes as JSON a view may`);
}

function answeredStep(text: string, { check }: Prepared, page: FoldPage): Step {
  if (utf8BytesWithin(text, page.mostViewBytes) > page.mostViewBytes) {
    return tooLarge(page);
  }
  const value = jsonOfText(text);
  const refused = check?.(value);
  return refused === undefined ? { view: value } : stalled('schema', refused);
}

function exhaustedStep(run: Stopped): Step {
  if (run.limit === 'deadline') {
    return { overtime: true };
  }
  return run.limit === 'stack'
    ? stalled('raised', run.issue.detail, run.issue.line)
    : stalled(run.limit, run.issue.detail, run.issue.line);
}

function stepOf(run: ProgramRun, prepared: Prepared, page: FoldPage): Step {
  if (run.ran === 'answered') {
    return answeredStep(run.text, prepared, page);
  }
  if (run.ran === 'exhausted') {
    return exhaustedStep(run);
  }
  return run.ran === 'oversized' ? tooLarge(page) : stalled(run.ran, run.issue.detail, run.issue.line);
}

function refusedStep(failed: ProgramFailure): Step {
  return failed.ran === 'exhausted'
    ? exhaustedStep(failed)
    : stalled('refused', `The fold does not load on this server: ${failed.issue.detail}`, failed.issue.line);
}

function momentOf(event: JsonObject): number {
  const time = textField(event, 'time');
  return time === undefined ? 0 : Date.parse(time);
}

function after(state: FoldedView, at: number, { step, work }: Folded): FoldedView {
  const spent = { ...state, through: at, work: state.work + work };
  if ('view' in step) {
    return { ...spent, view: step.view, folded: state.folded + 1, lastFolded: at };
  }
  return 'stall' in step ? { ...spent, stall: { at, ...step.stall } } : { ...spent, overtime: at };
}

function turnOf(folding: Folding, { at, event }: PlacedEvent, turns: Turns): FoldedView {
  const { ready } = folding.prepared;
  if ('failed' in ready) {
    return after(folding.state, at, { step: refusedStep(ready.failed), work: 0 });
  }
  const evaluation: Evaluation = {
    budget: turns.page.budget,
    deadlineAt: turns.host.now() + turns.page.foldDeadlineMs,
    moment: momentOf(event),
  };
  const matching = matchingOf(ready.filters, event, (test, actual) => test(JSON.stringify(actual), evaluation));
  if ('stopped' in matching) {
    return after(folding.state, at, { step: exhaustedStep(matching.stopped), work: matching.stopped.work });
  }
  if (!matching.matched) {
    return { ...folding.state, through: at, work: folding.state.work + matching.work };
  }
  const run = ready.fold(JSON.stringify(event), evaluation);
  return after(folding.state, at, { step: stepOf(run, folding.prepared, turns.page), work: run.work + matching.work });
}

function isGoing({ state }: Folding): boolean {
  return state.stall === undefined && state.overtime === undefined;
}

function isSpent({ page, host, firstFoldAt }: Turns): boolean {
  const first = firstFoldAt();
  return first !== undefined && host.now() - first >= page.pageBudgetMs;
}

interface EventFolded {
  readonly foldings: readonly Folding[];
  readonly early: boolean;
}

function foldEvent(foldings: readonly Folding[], placed: PlacedEvent, turns: Turns): EventFolded {
  const next: Folding[] = [];
  for (const [index, folding] of foldings.entries()) {
    if (!isGoing(folding) || !folding.prepared.considered.has(placed.at)) {
      next.push({ ...folding, state: { ...folding.state, through: placed.at } });
    } else if (isSpent(turns)) {
      return { foldings: [...next, ...foldings.slice(index)], early: true };
    } else {
      turns.take();
      turns.host.folding(placed.at, index);
      next.push({ ...folding, state: turnOf(folding, placed, turns) });
    }
  }
  return { foldings: next, early: false };
}

function viewsOf(foldings: readonly Folding[]): readonly FoldedView[] {
  return foldings.map(({ state }) => state);
}

function turnsOf(page: FoldPage, host: FoldHost): Turns {
  const first: { at?: number } = {};
  return {
    page,
    host,
    firstFoldAt: () => first.at,
    take: () => {
      first.at ??= host.now();
    },
  };
}

function foldedThrough(page: FoldPage, turns: Turns, start: readonly Folding[]): FoldedPage {
  let foldings = start;
  for (const [at, event] of page.events.entries()) {
    const folded = foldEvent(foldings, { at, event }, turns);
    foldings = folded.foldings;
    if (folded.early) {
      return { early: true, views: viewsOf(foldings) };
    }
  }
  return { early: false, views: viewsOf(foldings) };
}

export function foldPage(page: FoldPage, host: FoldHost): FoldedPage {
  const foldings = Array.zip(page.views, host.instances).map((placed: readonly [FoldingView, SandboxInstance]) =>
    foldingOf(placed, page, host),
  );
  try {
    return foldedThrough(page, turnsOf(page, host), foldings);
  } finally {
    for (const { prepared } of foldings) {
      prepared.close();
    }
  }
}
