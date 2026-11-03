import { defineQuery } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { RunReadSchema } from '../page/page-shown.ts';
import type { SubjectPages } from '../page/subject-pages-port.ts';
import { runWordsFor } from '../plain-language/run-words.ts';
import { runDetailOf } from '../runs/run-lookup.ts';
import type { RunDetail } from '../runs/run.ts';
import { RunIdInputField } from './definition-fields.ts';
import { loadRun } from './run-access.ts';

export function foundRun(id: string) {
  return loadRun(id).pipe(Effect.flatMap((state) => runDetailOf(id, state)));
}

function withItsResult(pages: SubjectPages, detail: RunDetail) {
  return Effect.orDie(pages.resultOf(detail.type, detail.name, { run: detail })).pipe(
    Effect.map((result) => (result === undefined ? detail : { ...detail, page: { result } })),
  );
}

export function defineGetRun(capabilities: readonly Capability[], pages: SubjectPages) {
  const runWords = runWordsFor(capabilities);
  return defineQuery('playbook', {
    name: 'get_run',
    title: 'Get run',
    description: [
      'Reads one run of the playbook by its id: the definition and version that ran, who started it and when, its status,',
      'and its output or why it did not succeed, with the record its type keeps, such as the prompt and tokens of a reasoning function.',
      'A run is started until it ends as succeeded, rejected or failed.',
      'Use it to tell the person how a run ended; list_playbook_events with its run_id shows each step and tool call of the run.',
      'A run whose definition has a page answers page.result.',
      '`run_id` is the id run_definition answered with or was given.',
    ].join(' '),
    route: { method: 'GET', path: '/runs/{run_id}' },
    inputSchema: Schema.Struct({ run_id: RunIdInputField }),
    outputSchema: RunReadSchema,
    reasons: ['not_found'],
    handle: ({ run_id: id }) => Effect.flatMap(foundRun(id), (detail) => withItsResult(pages, detail)),
    plainLanguage: {
      task: 'look up a run',
      attempt: () => 'look up the run',
      outcome: (run) => runWords(run, 'looked up'),
    },
  });
}
