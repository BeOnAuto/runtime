import { tracker } from '@on.auto/providers/testing';
import { describe, expect, it } from 'vitest';

import { providersListedOf } from '../testing/listed-ways.ts';

const summary = 'Lets your playbooks read and change the issues of a tracker.';

describe('the one sentence of a provider, as the page lists it', () => {
  it('is given where its entry gives one, beside its description', async () => {
    const [listed] = await providersListedOf({ ...tracker, summary });

    expect(listed).toMatchObject({ name: 'tracker', description: tracker.description, summary });
  });

  it('is left out where its entry gives none', async () => {
    const [listed] = await providersListedOf(tracker);

    expect(listed).not.toHaveProperty('summary');
  });
});

describe('the icons of a provider, as the page lists them', () => {
  it('are the icons it was read with, each a data URI with its type, and its sizes and theme where given', async () => {
    const icons = [
      { src: 'data:image/svg+xml;base64,PHN2Zy8+', mimeType: 'image/svg+xml', theme: 'light' },
      { src: 'data:image/png;base64,iVBORw0KGgo=', mimeType: 'image/png', sizes: ['48x48'], theme: 'dark' },
    ] as const;
    const [listed] = await providersListedOf(tracker, icons);

    expect(listed).toMatchObject({ name: 'tracker', icons });
  });

  it('are left out where it was read with none', async () => {
    const [listed] = await providersListedOf(tracker);

    expect(listed).not.toHaveProperty('icons');
  });
});
