import type { ContentOwner, KeptContentHead } from '../content/recorded-content.ts';
import type { ContentToKeep } from '../content/streamed-content.ts';
import type { ErasingContent } from './content-entry.ts';
import { resultOf, type Generated } from './content-samples.ts';

export const keptAt = Date.parse('2026-11-01T09:00:00.000Z');

export const aDay = 86_400_000;

export const oneChunk = 1000;

export const severalChunks = 2_500_000;

export type Way = (generated: Generated) => ContentToKeep;

export const whole: Way = ({ content }) => content();

export const byItsDigest: Way = ({ sha256, content }) => ({ ...content(), expected: { sha256 } });

export function expiringAt(content: ContentToKeep, expiresAt: number | undefined): ContentToKeep {
  return expiresAt === undefined ? content : { ...content, expiresAt };
}

export function heldUntil(content: ContentToKeep, released: Promise<void>): ContentToKeep {
  const reader = content.stream.getReader();
  return {
    ...content,
    stream: new ReadableStream<Uint8Array>({
      start: () => released,
      pull: async (controller) => {
        const read = await reader.read();
        if (read.done) {
          controller.close();
        } else {
          controller.enqueue(read.value);
        }
      },
    }),
  };
}

export function headOf(
  { content }: ErasingContent,
  playbook: ContentOwner,
  sha256: string,
): Promise<KeptContentHead | undefined> {
  return resultOf(content.getHead(playbook, sha256));
}

export function keptHead(head: Omit<KeptContentHead, 'expiresAt'>, expiresAt: number | undefined): KeptContentHead {
  return expiresAt === undefined ? head : { ...head, expiresAt };
}
