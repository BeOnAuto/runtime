import { describe, expect, it } from 'vitest';

import { isHttpsOrLoopback, loopbackNames, namesTheLoopback } from '../index.ts';

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

describe('an origin a browser is sent to', () => {
  it('is an https origin, or an origin on a loopback name, and never what does not parse as one', () => {
    expect(
      [
        'https://runtime.example',
        'http://localhost:5555',
        'http://127.0.0.1',
        'http://[::1]:5555',
        'http://runtime.example',
        'http://127.0.0.2:5555',
        'runtime.example',
      ].map((origin) => isHttpsOrLoopback(origin)),
    ).toEqual([true, true, true, true, false, false, false]);
  });
});
