import type { Schema } from 'effect';

export const writtenSamples: Readonly<Record<string, Schema.Json>> = {
  categories: {
    unit: null,
    values: [
      { name: 'Tokyo', value: 13.9, low: null, high: null },
      { name: 'Osaka', value: 2.7, low: 2.6, high: null },
    ],
  },
  series: {
    unit: 'C',
    period: 'month',
    origin: null,
    lines: [
      {
        name: 'Oslo',
        points: [
          { at: '2025-01', value: -4, low: null, high: null },
          { at: '2025-02', value: -4, low: null, high: null },
        ],
      },
    ],
    marks: null,
  },
  table: {
    columns: [
      { name: 'City', unit: null },
      { name: 'Pop', unit: 'millions' },
    ],
    rows: [['Paris', 2.1]],
  },
  text: { text: 'Hello.' },
  ticket: {
    category: 'technical',
    priority: 2,
    customer: { name: 'Dana', email: null, plan: 'pro' },
    summary: 'Exports fail',
    follow_up: null,
    tags: null,
  },
  invoice: {
    invoice_id: '9b2f6c1e-4d7a-4f3b-8e21-5c9d0a7b3e44',
    issued: '2026-11-03',
    vendor_site: 'https://northwind.example.com/billing',
    lines: [{ description: 'Paper', quantity: 12, unit_price: 4.5 }],
    total: 54,
    currency: 'EUR',
    notes: null,
  },
  decision: { verdict: { kind: 'reject', reason: 'Over the limit' }, reviewer_note: null },
  scores: {
    scores: [
      { key: 'TrailMate', value: 7 },
      { key: 'PathPal', value: 6 },
    ],
    winner: 'TrailMate',
  },
};

export const readBackAnswers: Readonly<Record<string, Schema.Json>> = {
  categories: {
    values: [
      { name: 'Tokyo', value: 13.9 },
      { name: 'Osaka', value: 2.7, low: 2.6 },
    ],
  },
  series: {
    unit: 'C',
    period: 'month',
    lines: [
      {
        name: 'Oslo',
        points: [
          { at: '2025-01', value: -4 },
          { at: '2025-02', value: -4 },
        ],
      },
    ],
  },
  table: {
    columns: [{ name: 'City' }, { name: 'Pop', unit: 'millions' }],
    rows: [['Paris', 2.1]],
  },
  text: { text: 'Hello.' },
  ticket: { category: 'technical', priority: 2, customer: { name: 'Dana', plan: 'pro' }, summary: 'Exports fail' },
  invoice: {
    invoice_id: '9b2f6c1e-4d7a-4f3b-8e21-5c9d0a7b3e44',
    issued: '2026-11-03',
    vendor_site: 'https://northwind.example.com/billing',
    lines: [{ description: 'Paper', quantity: 12, unit_price: 4.5 }],
    total: 54,
    currency: 'EUR',
  },
  decision: { verdict: { kind: 'reject', reason: 'Over the limit' } },
  scores: { scores: { TrailMate: 7, PathPal: 6 }, winner: 'TrailMate' },
};
