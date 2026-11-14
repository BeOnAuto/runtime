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

export function retiredAlready(playbook: string): Conflict {
  return new Conflict({
    detail: `The playbook ${playbook} is retired and cannot change until it is restored`,
    kind: 'retired',
  });
}

export interface Changed {
  readonly name?: string;
  readonly description?: string;
  readonly page?: string | null;
}

export function renamedOrRedescribed(existing: Playbook, { name, description }: Changed) {
  return name === undefined && description === undefined
    ? Effect.succeed(existing)
    : recordInRegistry({
        type: 'update',
        playbook: existing.id,
        name: name ?? existing.name,
        description: description ?? existing.description,
      });
}

export const updatePlaybookFields = {
  playbook: PlaybookIdField,
  name: Schema.optionalKey(PlaybookNameField),
  description: Schema.optionalKey(PlaybookDescriptionField),
  page: Schema.optionalKey(PlaybookPageField),
};

interface Updating extends Changed {
  readonly playbook: string;
}

function playbookUpdated(pages: PlaybookPages, { playbook, ...changed }: Updating) {
  return Effect.gen(function* () {
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
    return yield* renamedOrRedescribed(existing, changed);
  });
}

export const updatePlaybookWords = {
  task: 'update a playbook',
  attempt: ({ playbook }: { readonly playbook: string }) => `update the playbook ${quoted(playbook)}`,
  outcome: (playbook: Pick<Playbook, 'name' | 'description'>) =>
    `Updated ${playbookNamed(playbook)}.${purposeOf(playbook, ' It has no description now.')}`,
};

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
    inputSchema: Schema.Struct(updatePlaybookFields),
    outputSchema: PlaybookSchema,
    reasons: ['not_found', 'invalid_input', 'conflict', 'unavailable'],
    handle: (input) => Effect.flatMap(playbookUpdated(pages, input), (updated) => withItsPage(pages, updated)),
    plainLanguage: updatePlaybookWords,
  });
}
