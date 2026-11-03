import { defineHttpOperation, NotFound } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { playbookSubject } from '../page/subject-pages-port.ts';
import type { SubjectPages } from '../page/subject-pages-port.ts';
import { viewsShownOf } from './saved-pages.ts';

const PlaybookPageSchema = Schema.Struct({
  lately: Schema.optionalKey(
    Schema.String.annotate({
      description: "What the playbook's page shows over its views, Markdown with charts as fenced blocks",
    }),
  ),
  standing: Schema.optionalKey(
    Schema.JsonObject.annotate({
      description: "How the page's views stand: live, rebuilding, waiting or stalled, and how far they have read",
    }),
  ),
}).annotate({ identifier: 'PlaybookPage', description: "The playbook's page, rendered now" });

const description = [
  "Renders the playbook's page now and answers it with page.lately, over its views as they stand, and page.standing, how they stand.",
  "Use it to show the playbook's dashboard; get_playbook reads the page's source.",
  'A playbook without a page is refused as not found.',
].join(' ');

const NoInput = Schema.Never.annotate({
  message: 'render_playbook_page takes no input; send no body, or an empty object',
});

const noPlaybookPage = new NotFound({ detail: 'The playbook has no page; save one with update_playbook' });

export function defineRenderPlaybookPage(pages: SubjectPages) {
  return defineHttpOperation('playbook', 'query', {
    name: 'render_playbook_page',
    title: 'Render playbook page',
    description,
    route: { method: 'POST', path: '/render' },
    body: { kind: 'json' },
    inputSchema: Schema.Record(Schema.String, NoInput),
    outputSchema: Schema.Struct({ page: PlaybookPageSchema }),
    reasons: ['not_found'],
    handle: Effect.fnUntraced(function* () {
      const page = yield* pages.playbookPageOf();
      if (page === undefined) {
        return yield* noPlaybookPage;
      }
      const lately = yield* pages.latelyOf(playbookSubject);
      const standing = yield* pages.standingOf(playbookSubject);
      return {
        page: viewsShownOf(lately, standing),
      };
    }),
  });
}
