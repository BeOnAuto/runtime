export const mostOutcomeCharacters = 400;

export const mostRefusalCharacters = 600;

const restInTheDetails = ' The rest is in the details below.';

const betweenSentences = /(?<=[.!?…]["”’)]*)\s+(?=["“‘(]?[A-Z])/u;

function cutAtAWord(text: string, room: number): string {
  const cut = text.slice(0, room - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export function withinCharacters(text: string, most: number): string {
  if (text.length <= most) {
    return text;
  }
  const sentences = text.split(betweenSentences);
  if (sentences.join(' ').length <= most) {
    return sentences.join(' ');
  }
  const room = most - restInTheDetails.length;
  const overflowing = sentences.findIndex((_, index) => sentences.slice(0, index + 1).join(' ').length > room);
  const opening = overflowing === 0 ? cutAtAWord(text, room) : sentences.slice(0, overflowing).join(' ');
  return `${opening}${restInTheDetails}`;
}
