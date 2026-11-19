import { Context, Effect, Option } from 'effect';

import type { PlaybookAddress } from '../caller/playbook-context.ts';
import {
  playbookBoundAppendedFactsReader,
  playbookBoundProjectionReader,
  playbookBoundRecordedReader,
  playbookBoundRunOutcomesReader,
  prefixedAges,
  prefixedReader,
  prefixedWriter,
  definitionOfStreamPrefix,
  streamPrefixOfDefinition,
  streamPrefixOfPlaybook,
} from './bound-ports.ts';
import { definitionsWriterOf } from './definitions-writer.ts';
import type { LedgerPorts } from './ledger.ts';
import { PlaybookReader } from './playbook-reader.ts';
import { PlaybookWriter } from './playbook-writer.ts';

function definitionPrefixIn({ org }: PlaybookAddress): (definition: string) => string {
  return (definition) => streamPrefixOfDefinition({ org, definition });
}

function definitionOfKey(definitionKey: string | undefined): string | undefined {
  return definitionKey === undefined
    ? undefined
    : Option.getOrUndefined(Option.map(definitionOfStreamPrefix(definitionKey), ({ definition }) => definition));
}

export function playbookReaderOf(ledger: LedgerPorts, address: PlaybookAddress): PlaybookReader['Service'] {
  const prefix = streamPrefixOfPlaybook(address);
  const definitionPrefix = definitionPrefixIn(address);
  return {
    ...prefixedReader(ledger, prefix),
    ...prefixedAges(ledger, prefix),
    ...playbookBoundRecordedReader(ledger, address),
    ...playbookBoundAppendedFactsReader(ledger, address),
    ...playbookBoundRunOutcomesReader(ledger, address),
    ...playbookBoundProjectionReader(ledger, address),
    readContent: (sha256) => ledger.content.get(address, sha256),
    readContentHead: (sha256) => ledger.content.getHead(address, sha256),
    ofDefinition: (definition) => ({
      ...prefixedReader(ledger, definitionPrefix(definition)),
      ...prefixedAges(ledger, definitionPrefix(definition)),
    }),
    holderOfName: (definitionType, name) => ledger.holderOfName({ playbookKey: prefix, definitionType, name }),
    namesHeldIn: (definitionType) => ledger.namesHeldIn({ playbookKey: prefix, definitionType }),
    definitionHolding: (stream) => Effect.map(ledger.holderOfStream({ playbookKey: prefix, stream }), definitionOfKey),
  };
}

export function playbookWriterOf(ledger: LedgerPorts, address: PlaybookAddress): PlaybookWriter['Service'] {
  return {
    ...prefixedWriter(ledger, streamPrefixOfPlaybook(address)),
    keepContent: (content) => ledger.content.put(address, content),
    ofDefinition: (definition) => prefixedWriter(ledger, definitionPrefixIn(address)(definition)),
    ...definitionsWriterOf(ledger, address),
  };
}

export function playbookLedgerOf(
  ledger: LedgerPorts,
  address: PlaybookAddress,
): Context.Context<PlaybookReader | PlaybookWriter> {
  return Context.make(PlaybookReader, playbookReaderOf(ledger, address)).pipe(
    Context.add(PlaybookWriter, playbookWriterOf(ledger, address)),
  );
}
