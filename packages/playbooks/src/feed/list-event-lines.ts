import { defineHttpOperation, nothingKept, presentationOf, type Presenter } from '@on.auto/operations';
import { Effect } from 'effect';

import { EventsPage, feedInput, feedReader, requireSomePublicType } from './list-playbook-events.ts';

const description = [
  'Lists what happened in the playbook a page at a time, as list_playbook_events lists it for the same input,',
  'but with each content an event holds given by its digest and size alone, unread, so a page reads quickly;',
  'get_event reads one event whole.',
].join(' ');

const noContentRead = () => Effect.succeed(nothingKept);

export function defineListEventLines(presenters: readonly Presenter[]) {
  const presentation = presentationOf(presenters);
  requireSomePublicType(presentation.publicTypes);
  return defineHttpOperation('playbook', 'query', {
    name: 'list_event_lines',
    staleOn: [{ kind: 'event' }],
    title: 'List event lines',
    description,
    route: { method: 'GET', path: '/event-lines' },
    body: { kind: 'none' },
    inputSchema: feedInput(presentation.publicTypes),
    outputSchema: EventsPage,
    reasons: ['invalid_input'],
    handle: feedReader(presentation, noContentRead),
  });
}
