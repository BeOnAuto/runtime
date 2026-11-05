import { Conflict, defineCommand, InvalidInput, OrgContext } from '@on.auto/operations';
import { quoted } from '@on.auto/phrasing';
import { Effect, Schema } from 'effect';

import { playbookNamed, purposeOf } from '../plain-language/playbook-words.ts';
import { PlaybookSchema, type Playbook } from '../registry/playbook.ts';
import { PlaybookDescriptionField, PlaybookIdField, PlaybookNameField, PlaybookPageField } from './playbook-fields.ts';
import { withItsPage, type PlaybookPages } from './playbook-pages.ts';
import { foundPlaybook } from './registry-loading.ts';
import { recordInRegistry } from './registry-recording.ts';

const nothingGiven = new InvalidInput({
  detail: 'Give name, description or page, at least one, to update the playbook',
  issues: [{ pointer: '', detail: 'Give name, description or page, at least one, to update the playbook' }],
});

function retiredAlready(playbook: string): Conflict {
  return new Conflict({
    detail: `The playbook ${playbook} is retired and cannot change until it is restored`,
    kind: 'retired',
  });
}

interface Changed {
  readonly name?: string;
  readonly description?: string;
  readonly page?: string | null;
}

function renamedOrRedescribed(existing: Playbook, { name, description }: Changed) {
  return name === undefined && description === undefined
    ? Effect.succeed(existing)
    : recordInRegistry({
        type: 'update',
        playbook: existing.id,
        name: name ?? existing.name,
        description: description ?? existing.description,
      });
}

export function defineUpdatePlaybook(pages: PlaybookPages) {
  return defineCommand('org', {
    name: 'update_playbook',
    title: 'Update playbook',
    description: [
      'Changes the name, the description or the page of an active playbook and returns it.',
      'Use it when the person renames a playbook, changes what it is for or gives it a dashboard.',
      'What is left out stays as saved.',
    ].join(' '),
    repeatable: true,
    route: { method: 'PUT', path: '/playbooks/{playbook}' },
    inputSchema: Schema.Struct({
      playbook: PlaybookIdField,
      name: Schema.optionalKey(PlaybookNameField),
      description: Schema.optionalKey(PlaybookDescriptionField),
      page: Schema.optionalKey(PlaybookPageField),
    }),
    outputSchema: PlaybookSchema,
    reasons: ['not_found', 'invalid_input', 'conflict', 'unavailable'],
    handle: Effect.fnUntraced(function* ({ playbook, ...changed }) {
      if (changed.name === undefined && changed.description === undefined && changed.page === undefined) {
        return yield* nothingGiven;
      }
      const existing = yield* foundPlaybook(playbook);
      if (existing.status === 'retired') {
        return yield* retiredAlready(playbook);
      }
      if (changed.page !== undefined) {
        const { org } = yield* OrgContext;
        yield* pages.save({ org, playbook }, changed.page);
      }
      return yield* withItsPage(pages, yield* renamedOrRedescribed(existing, changed));
    }),
    plainLanguage: {
      task: 'update a playbook',
      attempt: ({ playbook }) => `update the playbook ${quoted(playbook)}`,
      outcome: (playbook) => `Updated ${playbookNamed(playbook)}.${purposeOf(playbook, ' It has no description now.')}`,
    },
  });
}
