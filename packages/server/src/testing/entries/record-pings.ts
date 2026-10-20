import { pingsRecordedIn } from '../records/recorded-pings.ts';

Object.defineProperty(globalThis, 'fetch', { value: pingsRecordedIn(process.env), writable: true, configurable: true });
