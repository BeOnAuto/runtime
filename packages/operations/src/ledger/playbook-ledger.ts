import { Context } from 'effect';

import type { PlaybookAddress } from '../caller/playbook-context.ts';
import {
  playbookBoundAppendedFactsReader,
  playbookBoundProjectionReader,
  playbookBoundRecordedReader,
  playbookBoundRunOutcomesReader,
  prefixedAges,
  prefixedReader,
  prefixedWriter,
  streamPrefixOfPlaybook,
} from './bound-ports.ts';
import type { LedgerPorts } from './ledger.ts';
import { PlaybookReader } from './playbook-reader.ts';
import { PlaybookWriter } from './playbook-writer.ts';

export function playbookReaderOf(ledger: LedgerPorts, address: PlaybookAddress): PlaybookReader['Service'] {
  const prefix = streamPrefixOfPlaybook(address);
  return {
    ...prefixedReader(ledger, prefix),
    ...prefixedAges(ledger, prefix),
    ...playbookBoundRecordedReader(ledger, address),
    ...playbookBoundAppendedFactsReader(ledger, address),
    ...playbookBoundRunOutcomesReader(ledger, address),
    ...playbookBoundProjectionReader(ledger, address),
    readContent: (sha256) => ledger.content.get(address, sha256),
    readContentHead: (sha256) => ledger.content.getHead(address, sha256),
  };
}

export function playbookWriterOf(ledger: LedgerPorts, address: PlaybookAddress): PlaybookWriter['Service'] {
  return {
    ...prefixedWriter(ledger, streamPrefixOfPlaybook(address)),
    keepContent: (content) => ledger.content.put(address, content),
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
