import type { BoundInput, ReadsFirst } from './query-schema.ts';

const NEAR_MS = 5 * 60 * 1000;

const NEAR_RUNS = 8;

const ANSWERING_RUNS = 4;

type Item = Readonly<Record<string, unknown>>;

interface Listed {
  readonly id: string;
  readonly name: string | undefined;
  readonly started: number;
  readonly within: string | undefined;
}

interface Thing {
  readonly opens: string | undefined;
  readonly until: string | undefined;
  readonly marks: readonly string[];
}

function isItem(value: unknown): value is Item {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function itemAt(item: Item | undefined, field: string): Item | undefined {
  return itemOf(item?.[field]);
}

function itemsAt(item: Item | undefined, field: string): readonly Item[] {
  const value = item?.[field];
  return Array.isArray(value) ? value.filter((each) => isItem(each)) : [];
}

function textAt(item: Item | undefined, field: string): string | undefined {
  const value = item?.[field];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function idOf(thing: Item): string | undefined {
  return textAt(itemAt(thing, 'per'), 'id');
}

function listedOf(runs: readonly Item[]): readonly Listed[] {
  return runs.flatMap((run) => {
    const [id, started] = [textAt(run, 'run_id'), textAt(run, 'started_at')];
    return id === undefined || started === undefined
      ? []
      : [
          {
            id,
            name: textAt(run, 'name'),
            started: Date.parse(started),
            within: textAt(itemAt(run, 'within'), 'run_id'),
          },
        ];
  });
}

function thingIn(open: readonly Item[], closed: readonly Item[], id: string): Thing {
  const opened = open.find((each) => idOf(each) === id);
  const ended = closed.find((each) => idOf(each) === id);
  const marks = itemsAt(opened, 'marks').toSorted((a, b) => Date.parse(String(a['at'])) - Date.parse(String(b['at'])));
  return {
    opens:
      textAt(itemAt(opened, 'window'), 'opens') ?? textAt(marks[0], 'at') ?? textAt(itemAt(ended, 'window'), 'opens'),
    until: textAt(ended, 'at'),
    marks: marks.flatMap((mark) => textAt(mark, 'run') ?? []),
  };
}

function nearest(runs: readonly Listed[], at: number, most: number): readonly Listed[] {
  return runs.toSorted((a, b) => Math.abs(a.started - at) - Math.abs(b.started - at)).slice(0, most);
}

function answeringOf(goal: Item): ReadonlySet<string> {
  const last = textAt(itemsAt(goal, 'milestones').at(-1), 'id');
  return new Set(
    itemsAt(goal, 'contributions').flatMap((contribution) => {
      const [workflow, marks] = [textAt(contribution, 'workflow'), textAt(contribution, 'marks')];
      return workflow !== undefined && marks !== undefined && marks === last ? [workflow] : [];
    }),
  );
}

function runsOfAThing(thing: Thing, listed: readonly Listed[], answering: ReadonlySet<string>): readonly string[] {
  if (thing.opens === undefined) return thing.marks;
  const at = Date.parse(thing.opens);
  const until = thing.until === undefined ? Number.POSITIVE_INFINITY : Date.parse(thing.until);
  const near = listed.filter(({ started }) => Math.abs(started - at) <= NEAR_MS);
  const answers = nearest(
    listed.filter(
      ({ name, started }) => name !== undefined && answering.has(name) && started >= at - NEAR_MS && started <= until,
    ),
    at,
    ANSWERING_RUNS,
  );
  const started = new Set(answers.map(({ id }) => id));
  const steps = listed.filter(({ within }) => within !== undefined && started.has(within));
  return [
    ...thing.marks,
    ...nearest(near, at, NEAR_RUNS).map(({ id }) => id),
    ...answers.map(({ id }) => id),
    ...nearest(steps, at, ANSWERING_RUNS).map(({ id }) => id),
  ];
}

export function runsBehindTheThings(goal: Item, first: ReadsFirst): readonly BoundInput[] {
  const assessments = itemAt(goal, 'assessments');
  const open = [itemAt(assessments, 'current'), ...itemsAt(assessments, 'in_flight')].filter(
    (each): each is Item => each !== undefined,
  );
  const closed = [...itemsAt(itemAt(assessments, 'closed'), 'latest'), ...itemsAt(itemOf(first['results']), 'items')];
  const runs = itemsAt(itemOf(first['runs']), 'runs');
  if (runs.some((run) => run['output'] !== undefined)) return [];
  const listed = listedOf(runs);
  const answering = answeringOf(goal);
  const things = [...new Set([...open, ...closed].flatMap((thing) => idOf(thing) ?? []))];
  const ids = new Set(things.flatMap((id) => runsOfAThing(thingIn(open, closed, id), listed, answering)));
  return [...ids].map((run) => ({ run_id: run }));
}

function itemOf(value: unknown): Item | undefined {
  return isItem(value) ? value : undefined;
}
