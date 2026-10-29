import { readFileSync } from 'node:fs';
import { registerHooks, type ResolveFnOutput } from 'node:module';

import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { textOfDocument } from '../reading/text-of-document.ts';
import { wordDocumentOf } from '../testing/written-documents.ts';

const wordType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const mammothManifest = import.meta.resolve('mammoth/package.json');

const decodeBrowserField = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ browser: Schema.Record(Schema.String, Schema.String) })),
);

const { browser } = decodeBrowserField(readFileSync(new URL(mammothManifest), 'utf8'));

const browserFileOf = new Map(
  Object.entries(browser).map(([file, browserFile]: readonly [string, string]) => [
    new URL(file, mammothManifest).href,
    new URL(browserFile, mammothManifest).href,
  ]),
);

const browserFilesLoaded = new Set<string>();

type ResolveContext = Readonly<{ parentURL: string | undefined }>;

type NextResolve = (specifier: string, context: ResolveContext) => ResolveFnOutput;

function resolvedForABrowser(specifier: string, context: ResolveContext, nextResolve: NextResolve): ResolveFnOutput {
  const resolved = nextResolve(specifier, context);
  const browserFile = browserFileOf.get(resolved.url);
  if (browserFile === undefined) {
    return resolved;
  }
  browserFilesLoaded.add(browserFile);
  return { ...resolved, url: browserFile };
}

registerHooks({ resolve: resolvedForABrowser });

const terms = wordDocumentOf(['Supplier terms', 'Payment & delivery <within 30 days>']);

const termsRead = { read: true, text: 'Supplier terms\n\nPayment & delivery <within 30 days>', mediaType: wordType };

function placedIn(buffer: Readonly<ArrayBufferLike>, offset: number): Uint8Array {
  const view = new Uint8Array(buffer, offset, terms.byteLength);
  view.set(terms);
  return view;
}

describe('the text of a Word document, its library resolved by its browser field as a bundler resolves it', () => {
  it('is the text of its paragraphs, read by the browser build of mammoth', async () => {
    const read = await textOfDocument({ bytes: terms, mediaType: wordType, name: undefined });

    expect({ read, browserFilesLoaded: [...browserFilesLoaded].toSorted() }).toEqual({
      read: termsRead,
      browserFilesLoaded: [...browserFileOf.values()].toSorted(),
    });
  });

  it('is read where its bytes are part of a larger buffer, and where they fill a shared one', async () => {
    const views: readonly Readonly<Uint8Array>[] = [
      placedIn(new ArrayBuffer(terms.byteLength + 7), 3),
      placedIn(new SharedArrayBuffer(terms.byteLength), 0),
    ];

    const reads = await Promise.all(
      views.map((bytes) => textOfDocument({ bytes, mediaType: wordType, name: undefined })),
    );

    expect(reads).toEqual([termsRead, termsRead]);
  });
});
