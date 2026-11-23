import { Option, Predicate, Schema } from 'effect';
import { importPKCS8 } from 'jose';

import { valueAt } from '../openapi/failure-codes.ts';
import { pkcs8Of } from './private-keys.ts';

export interface KeyFilePointers {
  readonly client_id: string;
  readonly private_key: string;
}

export type KeyFileTaken = { readonly format: 'pem' } | (KeyFilePointers & { readonly format?: 'json' });

export interface KeyFileRead {
  readonly clientId: string;
  readonly privateKey: string;
}

export const mostKeyFileBytes = 16_384;

export const assertionAlgorithm = 'RS256';

const objectOfText = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)));

function textAt(file: Readonly<Record<string, unknown>>, pointer: string): string | undefined {
  const value = valueAt(file, pointer);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

const fewestKeyBits = 2048;

function signsWith({ algorithm }: { readonly algorithm: unknown }): boolean {
  return (
    Predicate.hasProperty(algorithm, 'modulusLength') &&
    typeof algorithm.modulusLength === 'number' &&
    algorithm.modulusLength >= fewestKeyBits
  );
}

function importsForSigning(privateKey: string): Promise<boolean> {
  return importPKCS8(privateKey, assertionAlgorithm).then(signsWith, () => false);
}

function valuesIn(text: string, pointers: KeyFilePointers): KeyFileRead | undefined {
  const file = Option.getOrUndefined(objectOfText(text));
  if (file === undefined) {
    return undefined;
  }
  const clientId = textAt(file, pointers.client_id);
  const privateKey = textAt(file, pointers.private_key);
  return clientId === undefined || privateKey === undefined ? undefined : { clientId, privateKey };
}

function isWithin(text: string, mostBytes: number): boolean {
  return new TextEncoder().encode(text).byteLength <= mostBytes;
}

export async function keyFileOf(
  text: string,
  pointers: KeyFilePointers,
  mostBytes = mostKeyFileBytes,
): Promise<KeyFileRead | undefined> {
  if (!isWithin(text, mostBytes)) {
    return undefined;
  }
  const read = valuesIn(text, pointers);
  return read !== undefined && (await importsForSigning(read.privateKey)) ? read : undefined;
}

export async function pemKeyOf(text: string, mostBytes = mostKeyFileBytes): Promise<string | undefined> {
  const privateKey = isWithin(text, mostBytes) ? pkcs8Of(text) : undefined;
  return privateKey !== undefined && (await importsForSigning(privateKey)) ? privateKey : undefined;
}

export async function keyFileReadOf(
  text: string,
  taken: KeyFileTaken,
  clientId: string | undefined,
): Promise<KeyFileRead | undefined> {
  if (taken.format !== 'pem') {
    return keyFileOf(text, taken);
  }
  const privateKey = clientId === undefined ? undefined : await pemKeyOf(text);
  return clientId === undefined || privateKey === undefined ? undefined : { clientId, privateKey };
}
