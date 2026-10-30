import { Effect, Result, Schema } from 'effect';

import {
  ActedContextSchema,
  PlaybookIdSchema,
  NotFound,
  OrgReader,
  OrgWriter,
  defineCommand,
  defineQuery,
  factOf,
  type Decider,
} from '../index.ts';
import { testedContext } from './callers.ts';

const PlaybookLabelSchema = Schema.Struct({ playbook: PlaybookIdSchema, label: Schema.String });

type PlaybookLabel = typeof PlaybookLabelSchema.Type;

const PlaybookLabelledSchema = factOf('playbook_labelled', PlaybookLabelSchema, ActedContextSchema);

type PlaybookLabelled = typeof PlaybookLabelledSchema.Type;

const labelBook: Decider<readonly PlaybookLabel[], PlaybookLabel, PlaybookLabelled> = {
  initialState: [],
  evolve: (labels, { data: labelled }) => [
    ...labels.filter(({ playbook }) => playbook !== labelled.playbook),
    labelled,
  ],
  decide: (labelled) => Result.succeed([{ type: 'playbook_labelled', data: labelled }]),
  context: () => testedContext,
  eventSchema: PlaybookLabelledSchema,
};

export const labelPlaybook = defineCommand('org', {
  name: 'label_playbook',
  title: 'Label playbook',
  description: 'Gives a playbook of the org a label.',
  route: { method: 'PUT', path: '/playbooks/{playbook}/label' },
  inputSchema: PlaybookLabelSchema,
  outputSchema: PlaybookLabelSchema,
  reasons: ['conflict'],
  handle: Effect.fnUntraced(function* (labelled) {
    yield* (yield* OrgWriter).execute('playbook-labels', labelBook, labelled);
    return labelled;
  }),
});

export const relabelPlaybook = defineCommand('org', {
  name: 'relabel_playbook',
  title: 'Relabel playbook',
  description: 'Gives a playbook of the org a label named in the body.',
  route: { method: 'POST', path: '/playbook-labels' },
  inputSchema: PlaybookLabelSchema,
  outputSchema: PlaybookLabelSchema,
  reasons: ['conflict'],
  handle: Effect.fnUntraced(function* (labelled) {
    yield* (yield* OrgWriter).execute('playbook-labels', labelBook, labelled);
    return labelled;
  }),
});

export const getPlaybookLabel = defineQuery('org', {
  name: 'get_playbook_label',
  title: 'Get playbook label',
  description: 'Reads the label of a playbook of the org.',
  route: { method: 'GET', path: '/playbooks/{playbook}/label' },
  inputSchema: Schema.Struct({ playbook: PlaybookIdSchema }),
  outputSchema: PlaybookLabelSchema,
  reasons: ['not_found'],
  handle: Effect.fnUntraced(function* ({ playbook }) {
    const { state } = yield* (yield* OrgReader).load('playbook-labels', labelBook);
    const found = state.find((labelled) => labelled.playbook === playbook);
    if (found === undefined) {
      return yield* new NotFound({ detail: `The playbook ${playbook} has no label` });
    }
    return found;
  }),
});

export const listPlaybookLabels = defineQuery('org', {
  name: 'list_playbook_labels',
  title: 'List playbook labels',
  description: 'Lists the labels of the playbooks of the org.',
  route: { method: 'GET', path: '/playbook-labels' },
  inputSchema: Schema.Record(Schema.String, Schema.Never),
  outputSchema: Schema.Struct({ labels: Schema.Array(PlaybookLabelSchema) }),
  reasons: [],
  handle: Effect.fnUntraced(function* () {
    const { state } = yield* (yield* OrgReader).load('playbook-labels', labelBook);
    return { labels: state };
  }),
});
