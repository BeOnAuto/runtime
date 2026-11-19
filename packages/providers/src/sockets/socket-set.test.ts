import { describe, expect, it } from 'vitest';

import { socketKeyOf, socketStepsOf, stillRefused, type SocketKeyed } from './socket-set.ts';

const ofTheChat = { provider: 'chat', at: 0 };

describe('the key of a socket', () => {
  it('is one for each entry, destination and value, so connections that hold one value share one socket across orgs', () => {
    const keys = [
      { ...ofTheChat, digest: 'd1' },
      { ...ofTheChat, digest: 'd1' },
      { ...ofTheChat, digest: 'd2' },
      { provider: 'rooms', at: 0, digest: 'd1' },
      { ...ofTheChat, at: 1, digest: 'd1' },
    ].map((keyed: SocketKeyed) => socketKeyOf(keyed));

    expect(new Set(keys).size).toBe(4);
    expect(keys[0]).toBe(keys[1]);
  });
});

describe('the steps toward the sockets wanted', () => {
  it('open each wanted socket none runs, close each running socket no longer wanted, and regroup one whose holders changed', () => {
    const steps = socketStepsOf({
      wanted: new Map([
        ['new', ['acme/c1']],
        ['kept', ['acme/c2']],
        ['regrouped', ['acme/c3', 'globex/c9']],
      ]),
      running: new Map([
        ['kept', ['acme/c2']],
        ['regrouped', ['acme/c3']],
        ['gone', ['acme/c4']],
      ]),
      refused: new Set(),
    });

    expect(steps).toEqual({ open: ['new'], close: ['gone'], regroup: ['regrouped'] });
  });

  it('open no socket whose value the service refused while it is still wanted, and forget the refusal once it is not', () => {
    const wanted = new Map([['refused', ['acme/c1']]]);
    const refused = new Set(['refused', 'replaced']);

    expect(socketStepsOf({ wanted, running: new Map(), refused })).toEqual({ open: [], close: [], regroup: [] });
    expect([...stillRefused(refused, wanted)]).toEqual(['refused']);
  });
});
