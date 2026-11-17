import { sha256Of } from '@on.auto/content';
import {
  assetContentOf,
  assetUnusable,
  type AssetHolding,
  type AssetReference,
  type HeldAsset,
  type PlaybookAddress,
} from '@on.auto/operations';
import { Effect } from 'effect';

export interface KeptForATest {
  readonly reference: AssetReference;
  readonly playbook: PlaybookAddress;
  readonly content: Readonly<Uint8Array>;
  readonly expired?: boolean;
  readonly removed?: boolean;
}

export interface HeldForATest extends AssetHolding {
  readonly opened: () => number;
}

const encoder = new TextEncoder();

const pieceBytes = 65_536;

const playbookOfTheTests: PlaybookAddress = { org: 'acme', playbook: 'alpha' };

export function keptForATest(
  id: string,
  mediaType: string,
  content: string | Readonly<Uint8Array>,
  playbook = playbookOfTheTests,
): KeptForATest {
  const bytes = typeof content === 'string' ? encoder.encode(content) : content;
  return {
    reference: {
      id,
      media_type: mediaType,
      bytes: bytes.byteLength,
      sha256: sha256Of(bytes),
      address: null,
      address_until: null,
    },
    playbook,
    content: bytes,
  };
}

function isOf(playbook: PlaybookAddress, kept: KeptForATest, id: string): boolean {
  return kept.reference.id === id && kept.playbook.org === playbook.org && kept.playbook.playbook === playbook.playbook;
}

function streamOf(content: Readonly<Uint8Array>): ReadableStream<Uint8Array> {
  let at = 0;
  return new ReadableStream<Uint8Array>({
    pull: (controller: Readonly<ReadableStreamDefaultController<Uint8Array>>) => {
      if (at >= content.byteLength) {
        controller.close();
        return;
      }
      controller.enqueue(content.slice(at, at + pieceBytes));
      at += pieceBytes;
    },
  });
}

function heldOf(found: KeptForATest, opened: () => void): HeldAsset {
  const { reference } = found;
  return {
    id: reference.id,
    mediaType: reference.media_type,
    bytes: found.content.byteLength,
    sha256: reference.sha256,
    content: assetContentOf(reference.media_type),
    opened: () => {
      opened();
      return found.removed === true
        ? Effect.fail(assetUnusable('content_gone', reference))
        : Effect.succeed(streamOf(found.content));
    },
  };
}

export function heldForATest(kept: readonly KeptForATest[]): HeldForATest {
  let opened = 0;
  const countedOpening = () => {
    opened += 1;
  };
  return {
    held: (playbook, reference) => {
      const found = kept.find((each) => isOf(playbook, each, reference.id));
      if (found === undefined) {
        return Effect.fail(assetUnusable('not_kept', reference));
      }
      if (found.reference.sha256 !== reference.sha256) {
        return Effect.fail(assetUnusable('other_bytes', reference));
      }
      return found.expired === true
        ? Effect.fail(assetUnusable('expired', reference))
        : Effect.succeed(heldOf(found, countedOpening));
    },
    opened: () => opened,
  };
}
