import { isAllocationFailure } from '@on.auto/workflow-engine/process-loop';

export interface DocumentGiven {
  readonly bytes: Readonly<Uint8Array>;
  readonly mediaType: string;
  readonly name: string | undefined;
}

export type DocumentRead =
  | { readonly read: true; readonly text: string }
  | { readonly read: false; readonly because: string };

export type DocumentText = DocumentRead & { readonly mediaType: string };

export interface DocumentType {
  readonly mediaType: string;
  readonly charset: string | undefined;
}

export type DocumentReader = (bytes: Readonly<Uint8Array>, type: DocumentType) => Promise<DocumentRead>;

export function textRead(text: string): DocumentRead {
  return { read: true, text };
}

export function notRead(because: string): DocumentRead {
  return { read: false, because };
}

export function viewOf(bytes: Readonly<Uint8Array>): Uint8Array {
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

const mostFailureCharacters = 300;

export function refusedUnlessOutOfMemory(error: unknown, refusal: string): DocumentRead {
  if (isAllocationFailure(error)) {
    throw error;
  }
  return notRead(`${refusal}: ${String(error).split('\n', 1).join('').slice(0, mostFailureCharacters)}`);
}
