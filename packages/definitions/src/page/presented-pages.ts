import type { PlaybookReader } from '@on.auto/operations';
import { Effect } from 'effect';

import { stagedRegistered } from '../read-model-staging/staged-definitions.ts';
import type { RegisteredDefinition } from '../registry/definition-registry.ts';
import type { PageStanding, SubjectPage } from './page-facts.ts';
import type { PageWritten } from './page-presenting.ts';
import { pageViewNameOf } from './page-view-names.ts';
import { carriedPageOf, type CarriedPage } from './pages-saved-as-definitions.ts';
import { playbookPageIn } from './playbook-pages.ts';
import { playbookSubject } from './subject-pages-port.ts';

type Read<A, E = never> = Effect.Effect<A, E, PlaybookReader>;

export interface WrittenPage {
  readonly page: SubjectPage;
  readonly written: PageWritten;
}

function carriedOrNot(carried: CarriedPage | undefined): WrittenPage | undefined {
  if (carried === undefined) {
    return undefined;
  }
  const { version, source, details } = carried;
  return { page: { version, source, details }, written: 'carried' };
}

interface PresentedPage extends PageStanding {
  readonly document: RegisteredDefinition['source'];
}

interface DefinitionPage {
  readonly page: PresentedPage;
  readonly written: PageWritten;
}

function presentedPageOf({ version, source, details }: SubjectPage): PresentedPage {
  return { version, details, document: { inline: source } };
}

function carriedPresented(carried: CarriedPage | undefined): DefinitionPage | undefined {
  const written = carriedOrNot(carried);
  return written === undefined ? undefined : { page: presentedPageOf(written.page), written: written.written };
}

function ownPageOf(type: string, stored: RegisteredDefinition, page: NonNullable<RegisteredDefinition['page']>) {
  const { version, source } = stored;
  const written: PageWritten = type === 'workflow' ? 'workflow' : 'function';
  return { page: { version, details: page.details, document: source }, written };
}

function writtenPageOf(type: string, stored: RegisteredDefinition | undefined): Read<DefinitionPage | undefined> {
  if (stored === undefined || stored.status === 'retired' || stored.page === null) {
    return Effect.undefined;
  }
  return stored.page === undefined
    ? Effect.map(carriedPageOf(pageViewNameOf({ type, name: stored.name })), carriedPresented)
    : Effect.succeed(ownPageOf(type, stored, stored.page));
}

export interface Presented extends DefinitionPage {
  readonly stored: RegisteredDefinition;
}

export const presentedOf = Effect.fnUntraced(function* (type: string, name: string) {
  const stored = yield* stagedRegistered({ reading: 'answers', read: 'definition_page' }, type, name);
  const written = yield* writtenPageOf(type, stored);
  return stored === undefined || written === undefined ? undefined : ({ ...written, stored } satisfies Presented);
});

export const writtenPlaybookPageOf: () => Read<WrittenPage | undefined> = () =>
  Effect.flatMap(playbookPageIn, ({ saves, page }) => {
    if (saves === 0) {
      return Effect.map(carriedPageOf(playbookSubject), carriedOrNot);
    }
    return Effect.succeed(page === undefined ? undefined : { page, written: 'playbook' as const });
  });
