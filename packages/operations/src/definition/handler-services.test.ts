import { describe, expectTypeOf, it } from 'vitest';

import type {
  BoundProjectionReader,
  PlaybookContentReader,
  PlaybookContentWriter,
  PlaybookAddress,
  PlaybookRecordedReader,
  PlaybookRunOutcomesReader,
  PlaybookRegistry,
  PlaybookReader,
  PlaybookContext,
  PlaybookWriter,
  IncidentReporter,
  Ledger,
  OrgAddress,
  OrgProjectionReader,
  OrgReader,
  OrgContext,
  OrgWriter,
  StreamAges,
  StreamReader,
  StreamWriter,
} from '../index.ts';
import type { OrgDefinitionsReader } from '../ledger/org-reader.ts';
import type { PlaybookDefinitionsReader } from '../ledger/playbook-reader.ts';
import type { PlaybookDefinitionsWriter } from '../ledger/playbook-writer.ts';
import type { OrgAppendedFactsReader, PlaybookAppendedFactsReader } from '../ledger/stream-ports.ts';
import type { HandlerServices } from './handler-services.ts';

describe('the services a handler may ask for', () => {
  it('give an org handler nothing of a playbook', () => {
    expectTypeOf<PlaybookContext>().not.toExtend<HandlerServices<'org', 'command'>>();
    expectTypeOf<PlaybookReader>().not.toExtend<HandlerServices<'org', 'command'>>();
    expectTypeOf<PlaybookWriter>().not.toExtend<HandlerServices<'org', 'command'>>();
  });

  it('give a playbook handler nothing of its org beyond the address of the call', () => {
    expectTypeOf<OrgContext>().not.toExtend<HandlerServices<'playbook', 'command'>>();
    expectTypeOf<OrgReader>().not.toExtend<HandlerServices<'playbook', 'command'>>();
    expectTypeOf<OrgWriter>().not.toExtend<HandlerServices<'playbook', 'command'>>();
  });

  it('give the writer of a scope to its commands only', () => {
    expectTypeOf<OrgWriter>().not.toExtend<HandlerServices<'org', 'query'>>();
    expectTypeOf<OrgWriter>().toExtend<HandlerServices<'org', 'command'>>();
    expectTypeOf<PlaybookWriter>().not.toExtend<HandlerServices<'playbook', 'query'>>();
    expectTypeOf<PlaybookWriter>().toExtend<HandlerServices<'playbook', 'command'>>();
  });

  it('never include the unbound ledger, the playbook registry or the incident reporter', () => {
    expectTypeOf<Ledger | PlaybookRegistry | IncidentReporter>().not.toExtend<HandlerServices<'org', 'query'>>();
    expectTypeOf<Ledger>().not.toExtend<HandlerServices<'org', 'command'>>();
    expectTypeOf<Ledger>().not.toExtend<HandlerServices<'playbook', 'query'>>();
    expectTypeOf<Ledger>().not.toExtend<HandlerServices<'playbook', 'command'>>();
    expectTypeOf<PlaybookRegistry>().not.toExtend<HandlerServices<'org', 'command'>>();
    expectTypeOf<PlaybookRegistry>().not.toExtend<HandlerServices<'playbook', 'command'>>();
    expectTypeOf<IncidentReporter>().not.toExtend<HandlerServices<'org', 'command'>>();
    expectTypeOf<IncidentReporter>().not.toExtend<HandlerServices<'playbook', 'command'>>();
  });
});

describe('the ports a handler sees', () => {
  it('bind every port a handler sees to the org or playbook of the call', () => {
    expectTypeOf<OrgContext['Service']>().toEqualTypeOf<OrgAddress>();
    expectTypeOf<PlaybookContext['Service']>().toEqualTypeOf<PlaybookAddress>();
    expectTypeOf<OrgReader['Service']>().toEqualTypeOf<
      StreamReader & OrgAppendedFactsReader & OrgProjectionReader & OrgDefinitionsReader
    >();
    expectTypeOf<OrgWriter['Service']>().toEqualTypeOf<StreamWriter>();
    expectTypeOf<PlaybookReader['Service']>().toEqualTypeOf<
      StreamReader &
        StreamAges &
        PlaybookRecordedReader &
        PlaybookAppendedFactsReader &
        PlaybookRunOutcomesReader &
        BoundProjectionReader &
        PlaybookContentReader &
        PlaybookDefinitionsReader
    >();
    expectTypeOf<PlaybookWriter['Service']>().toEqualTypeOf<
      StreamWriter & PlaybookContentWriter & PlaybookDefinitionsWriter
    >();
  });
});
