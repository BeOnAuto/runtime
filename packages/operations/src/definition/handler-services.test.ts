import { describe, expectTypeOf, it } from 'vitest';

import type {
  PlaybookContentReader,
  PlaybookAddress,
  PlaybookProjectionReader,
  PlaybookRecordedReader,
  PlaybookRunOutcomesReader,
  PlaybookRegistry,
  PlaybookReader,
  PlaybookContext,
  PlaybookWriter,
  HandlerServices,
  IncidentReporter,
  Ledger,
  OrgAddress,
  OrgReader,
  OrgContext,
  OrgWriter,
  StreamAges,
  StreamReader,
  StreamWriter,
} from '../index.ts';
import type { OrgAppendedFactsReader, PlaybookAppendedFactsReader } from '../ledger/stream-ports.ts';

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

  it('bind every port a handler sees to the org or playbook of the call', () => {
    expectTypeOf<OrgContext['Service']>().toEqualTypeOf<OrgAddress>();
    expectTypeOf<PlaybookContext['Service']>().toEqualTypeOf<PlaybookAddress>();
    expectTypeOf<OrgReader['Service']>().toEqualTypeOf<StreamReader & OrgAppendedFactsReader>();
    expectTypeOf<OrgWriter['Service']>().toEqualTypeOf<StreamWriter>();
    expectTypeOf<PlaybookReader['Service']>().toEqualTypeOf<
      StreamReader &
        StreamAges &
        PlaybookRecordedReader &
        PlaybookAppendedFactsReader &
        PlaybookRunOutcomesReader &
        PlaybookProjectionReader &
        PlaybookContentReader
    >();
    expectTypeOf<PlaybookWriter['Service']>().toEqualTypeOf<StreamWriter>();
  });
});
