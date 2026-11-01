import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { StudioLinks, studioLinkField, studioLinkTo, withStudioLink, type StudioPage } from './studio-links.ts';

const pageNamed = (page?: StudioPage) => `https://studio.example/${page === undefined ? 'home' : page.kind}`;

const aRun: StudioPage = { kind: 'run', playbook: 'alpha', run: 'r-1' };

const linked = <A>(effect: Effect.Effect<A>) =>
  Effect.runSync(effect.pipe(Effect.provideService(StudioLinks, pageNamed)));

describe('the link to a page in Studio', () => {
  it('is none unless the server serving the call knows the address of Studio', () => {
    expect([Effect.runSync(studioLinkTo()), Effect.runSync(studioLinkTo(aRun))]).toEqual([undefined, undefined]);
  });

  it("is the page the server's links give, Studio's home where no page is named", () => {
    expect([linked(studioLinkTo()), linked(studioLinkTo(aRun))]).toEqual([
      'https://studio.example/home',
      'https://studio.example/run',
    ]);
  });
});

describe('an output with its link in Studio', () => {
  it('carries the link as studio where the server knows the address of Studio, and is left as it is where not', () => {
    const output = { run_id: 'r-1' };

    expect([Effect.runSync(withStudioLink(output, aRun)), linked(withStudioLink(output, aRun))]).toEqual([
      { run_id: 'r-1' },
      { run_id: 'r-1', studio: 'https://studio.example/run' },
    ]);
  });

  it('declares studio as an optional field, the page in Studio of what was made, saved or run', () => {
    const schema = Schema.Struct({
      made: studioLinkField('made'),
      saved: studioLinkField('saved'),
      studio: studioLinkField('run'),
    });

    expect([Schema.decodeUnknownSync(schema)({}), Schema.decodeUnknownSync(schema)({ studio: 'https://s' })]).toEqual([
      {},
      { studio: 'https://s' },
    ]);
    expect(Schema.toJsonSchemaDocument(schema).schema).toMatchObject({
      properties: {
        made: { type: 'string', description: 'The page in Studio of what was made' },
        saved: { type: 'string', description: 'The page in Studio of what was saved' },
        studio: { type: 'string', description: 'The page in Studio of what was run' },
      },
    });
  });
});
