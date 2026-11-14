import { describe, expect, it } from 'vitest';

import { goalLinksOnNode } from './goal-links.ts';

const studio = { origin: 'https://studio.example', served: false };

const place = { playbook: 'alpha', goal: 'paying-customers', per: 'experiment-7' };

describe('the Studio address of a goal a Node server makes with no request in progress', () => {
  it('opens Studio on the runtime at the address the server is configured with', () => {
    expect(goalLinksOnNode(studio, () => 'https://runtime.example')(place)).toBe(
      'https://studio.example/?server=https%3A%2F%2Fruntime.example&src=agent&playbook=alpha&goal=paying-customers&per=experiment-7',
    );
  });

  it('opens the Studio the server serves itself, on the loopback', () => {
    expect(
      goalLinksOnNode({ ...studio, served: true }, () => 'http://127.0.0.1:5575')({ playbook: 'alpha', goal: 'g-1' }),
    ).toBe('http://127.0.0.1:5575/studio/?server=http%3A%2F%2F127.0.0.1%3A5575&src=agent&playbook=alpha&goal=g-1');
  });

  it('makes none where the server knows no address Studio can reach it at', () => {
    expect(goalLinksOnNode(studio, () => 'http://0.0.0.0:5555')(place)).toBeUndefined();
  });

  it('reads the address when the link is made, after the server listens', () => {
    let origin = 'http://0.0.0.0:0';
    const linkOf = goalLinksOnNode(studio, () => origin);
    const before = linkOf(place);
    origin = 'http://localhost:5575';

    expect([before, linkOf(place)?.startsWith('https://studio.example/?server=http%3A%2F%2Flocalhost%3A5575')]).toEqual(
      [undefined, true],
    );
  });
});
