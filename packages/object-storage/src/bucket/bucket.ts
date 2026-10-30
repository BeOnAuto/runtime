export interface ObjectHead {
  readonly bytes: number;
  readonly mediaType: string;
}

export interface ObjectRead extends ObjectHead {
  readonly stream: ReadableStream<unknown>;
}

export type ObjectBody =
  | { readonly data: Readonly<Uint8Array>; readonly mediaType?: string; readonly ifAbsent?: boolean }
  | { readonly stream: ReadableStream<Uint8Array>; readonly mediaType: string }
  | { readonly copyOf: string; readonly ifAbsent?: boolean };

export interface UnfinishedPut {
  readonly key: string;
  readonly abandon: () => Promise<void>;
}

export interface Bucket {
  readonly put: (key: string, body: ObjectBody) => Promise<boolean>;
  readonly get: (key: string) => Promise<ObjectRead | undefined>;
  readonly head: (key: string) => Promise<ObjectHead | undefined>;
  readonly delete: (keys: readonly string[]) => Promise<void>;
  readonly list: (prefix: string) => AsyncIterable<string>;
  readonly unfinished: (prefix: string) => AsyncIterable<UnfinishedPut>;
}
