import { Schema } from 'effect';

import type { StoredData } from '../emmett/emmett-event-store.ts';

type JsonText = { readonly json: string };

function parsed(json: string): unknown {
  return JSON.parse(json);
}

export const dataAsJsonText: StoredData<JsonText> = {
  stored: (data) => ({ json: JSON.stringify(data) }),
  read: ({ json }) => parsed(json),
};

const decodeJsonText = Schema.decodeUnknownSync(Schema.Struct({ json: Schema.String }));

export function storedDataOf(stored: unknown): unknown {
  return dataAsJsonText.read(decodeJsonText(stored));
}
