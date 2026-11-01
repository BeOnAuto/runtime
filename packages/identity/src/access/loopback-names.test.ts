import { describe, expect, it } from 'vitest';

import { loopbackNames, namesTheLoopback } from '../index.ts';

describe('the names of the loopback', () => {
  it('are localhost, 127.0.0.1 and [::1], as the host of a URL writes them', () => {
    expect(loopbackNames).toEqual(['localhost', '127.0.0.1', '[::1]']);
    expect(
      [
        'localhost',
        '127.0.0.1',
        '[::1]',
        new URL('http://LocalHost:5555/').hostname,
        '127.0.0.2',
        '::1',
        'evil.example',
      ].map((hostname) => namesTheLoopback(hostname)),
    ).toEqual([true, true, true, true, false, false, false]);
  });
});
