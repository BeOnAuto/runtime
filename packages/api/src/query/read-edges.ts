import { Predicate } from 'effect';
import { parse } from 'yaml';

import { PLAYBOOKS_LISTED, type BoundInput, type BoundRead, type ReadEdge } from './query-schema.ts';

function textAt(item: BoundInput, field: string): string | undefined {
  const value = item[field];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function definitionOf(type: string | undefined, name: string | undefined): BoundInput | undefined {
  return type === undefined || name === undefined ? undefined : { type, name };
}

function ofTheRun(run: string | undefined): BoundInput | undefined {
  return run === undefined ? undefined : { run_id: run };
}

function callsIn(value: unknown, found: Map<string, BoundInput>): void {
  if (Array.isArray(value)) {
    for (const each of value) callsIn(each, found);
    return;
  }
  if (!Predicate.isObject(value)) return;
  const called = Predicate.hasProperty(value, 'with') ? value.with : undefined;
  if (Predicate.hasProperty(value, 'call') && value.call === 'run_definition' && Predicate.isObject(called)) {
    const named = definitionOf(textAt({ ...called }, 'type'), textAt({ ...called }, 'name'));
    if (named !== undefined) found.set(`${String(named['type'])}/${String(named['name'])}`, named);
  }
  for (const inner of Object.values(value)) callsIn(inner, found);
}

export function definitionsCalledIn(source: unknown): readonly BoundInput[] {
  const found = new Map<string, BoundInput>();
  try {
    callsIn(typeof source === 'string' ? parse(source) : undefined, found);
  } catch {
    return [];
  }
  return [...found.values()];
}

function firstRunOf(request: BoundInput): string | undefined {
  const causes = Array.isArray(request['causes'])
    ? request['causes'].filter((cause): cause is string => typeof cause === 'string' && cause !== '')
    : [];
  const within = request['within'];
  return causes.at(-1) ?? (Predicate.isObject(within) ? textAt({ ...within }, 'run_id') : undefined);
}

function workflowOf(request: BoundInput): string | undefined {
  const within = request['within'];
  return Predicate.isObject(within) ? textAt({ ...within }, 'workflow') : undefined;
}

const RUN_ADDRESSED = /^[^/]+\/runs\/([^/]+)/u;

const REQUEST_ADDRESSED = /^[^/]+\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/u;

function runOfRow(row: BoundInput): string | undefined {
  const about = textAt(row, 'about') ?? '';
  return textAt(row, 'run_id') ?? RUN_ADDRESSED.exec(about)?.[1] ?? REQUEST_ADDRESSED.exec(about)?.[1];
}

function commentsOn(address: (item: BoundInput, playbook: string) => string | undefined): BoundRead {
  return {
    field: 'comments',
    operation: 'list_comments',
    description: 'The comments on it, read as list_comments reads them on its address',
    binds: ['address'],
    input: (item, playbook) => {
      const at = address(item, playbook);
      return at === undefined ? undefined : { address: at };
    },
  };
}

const theDefinitionWhole: BoundRead = {
  field: 'definition',
  operation: 'get_definition',
  description: 'The definition read whole, as get_definition reads it',
  binds: ['type', 'name'],
  input: (item) => definitionOf(textAt(item, 'type'), textAt(item, 'name')),
};

const itsRuns: BoundRead = {
  field: 'runs',
  operation: 'list_runs',
  description: 'The runs of the definition, as list_runs lists them by its type and name',
  binds: ['type', 'name'],
  input: (item) => definitionOf(textAt(item, 'type'), textAt(item, 'name')),
};

const definitionsCalled: BoundRead = {
  field: 'called',
  operation: 'get_definition',
  description: 'Each definition its document runs with run_definition, read whole, once each',
  binds: ['type', 'name'],
  input: (item) => definitionsCalledIn(item['source']),
  many: true,
};

const definitionComments = commentsOn((item, playbook) => {
  const [type, name, version] = [textAt(item, 'type'), textAt(item, 'name'), item['version']];
  return type === undefined || name === undefined || typeof version !== 'number'
    ? undefined
    : `${playbook}/definitions/${type}/${name}/${version}`;
});

function readsOfARun(runOf: (item: BoundInput) => string | undefined, whole: boolean): readonly BoundRead[] {
  return [
    {
      field: 'events',
      operation: 'list_playbook_events',
      description: 'The events of the run, as list_playbook_events lists them by its run_id',
      binds: ['run_id'],
      input: (item) => ofTheRun(runOf(item)),
    },
    {
      field: 'history',
      operation: 'get_run_history',
      description: 'The history of the run, as get_run_history reads it',
      binds: ['run_id'],
      input: (item) => ofTheRun(runOf(item)),
    },
    ...(whole
      ? [
          {
            field: 'run',
            operation: 'get_run',
            description: 'The run read whole, as get_run reads it',
            binds: ['run_id'],
            input: (item: BoundInput) => ofTheRun(runOf(item)),
          },
        ]
      : []),
    commentsOn((item, playbook) => {
      const run = runOf(item);
      return run === undefined ? undefined : `${playbook}/runs/${run}`;
    }),
  ];
}

const theRunId = (item: BoundInput) => textAt(item, 'run_id');

export const READ_EDGES: readonly ReadEdge[] = [
  PLAYBOOKS_LISTED,
  { operation: 'list_definitions', scope: 'playbook', at: ['definitions'], reads: [theDefinitionWhole, itsRuns] },
  { operation: 'get_definition', scope: 'playbook', at: [], reads: [definitionsCalled, itsRuns, definitionComments] },
  { operation: 'list_runs', scope: 'playbook', at: ['runs'], reads: readsOfARun(theRunId, true) },
  { operation: 'get_run', scope: 'playbook', at: [], reads: readsOfARun(theRunId, false) },
  {
    operation: 'list_interactions',
    scope: 'playbook',
    at: ['interactions'],
    reads: [
      {
        field: 'first_run_history',
        operation: 'get_run_history',
        description:
          'The history of the run its chain began with: the last of its causes, or the workflow run that asked',
        binds: ['run_id'],
        input: (item) => ofTheRun(firstRunOf(item)),
      },
      {
        field: 'workflow',
        operation: 'get_definition',
        description: 'The workflow that asked, read whole, as get_definition reads it',
        binds: ['type', 'name'],
        input: (item) => definitionOf('workflow', workflowOf(item)),
      },
    ],
  },
  {
    operation: 'get_playbook_goals',
    scope: 'playbook',
    at: ['goals'],
    reads: [
      {
        field: 'results',
        operation: 'list_goal_results',
        description: 'The results of the goal, as list_goal_results lists them',
        binds: ['goal'],
        input: (item) => {
          const goal = textAt(item, 'id');
          return goal === undefined ? undefined : { goal };
        },
      },
    ],
  },
  { operation: 'list_activity', scope: 'org', at: ['rows'], key: 'playbook', reads: readsOfARun(runOfRow, true) },
];
