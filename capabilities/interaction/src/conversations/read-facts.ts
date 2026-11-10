import { factReaderOf, type ProjectedMessage } from '@on.auto/operations';
import { ConversationCallEventSchema, type ReadingRecorded } from '@on.auto/tool-servers';

const readCall = factReaderOf(ConversationCallEventSchema);

function isReading(event: { readonly type: string }): event is ReadingRecorded {
  return event.type === 'replies_read' || event.type === 'reading_failed';
}

export function readingRecordedOf(message: ProjectedMessage): ReadingRecorded | undefined {
  const call = readCall(message);
  return call !== undefined && isReading(call) ? call : undefined;
}
