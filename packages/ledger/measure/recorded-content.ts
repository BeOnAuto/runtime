import { modestConnections } from '../src/sqlite3.ts';
import { contentTableHead, measuredContent } from './content-measurement.ts';
import { measuredOnEachStore, write, type MeasuredStore } from './stores.ts';

const held: string[] = [];

async function measured({ name, opened }: MeasuredStore): Promise<void> {
  const store = await opened();
  held.push(await measuredContent(name, store.content));
  await store.close();
}

contentTableHead();
await measuredOnEachStore(measured, { sqliteConnections: modestConnections });
write('');
held.forEach((line) => {
  write(line);
});
