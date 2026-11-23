import type { RenderedMessage } from './rendered-message.ts';

export interface ChatWords {
  readonly working: string;
  readonly stillWorking: string;
  readonly notAnswered: string;
  readonly boundReached: string;
  readonly stepsAlreadyDone: string;
  readonly shared: string;
  readonly toAnswerARequest: string;
  readonly notConnected: string;
  readonly disconnected: string;
  readonly help: string;
  readonly noModel: string;
  readonly notAdmitted: string;
  readonly notRecognised: string;
  readonly signInToUse: string;
  readonly signIn: string;
  readonly wrongCode: string;
  readonly anotherMember: string;
  readonly connected: (named: ConnectedAs) => string;
}

interface ConnectedAs {
  readonly account: string;
  readonly person: string;
}

export interface WrittenInAThread {
  readonly id: string;
  readonly sender?: string | undefined;
  readonly text: string;
  readonly automatic?: string | undefined;
}

export interface EarlierInAThread {
  readonly author: 'context' | 'assistant';
  readonly sender: undefined;
  readonly text: string;
}

export interface RememberedLine {
  readonly author: 'person' | 'assistant' | 'context' | 'overheard';
  readonly sender: string | undefined;
  readonly text: string;
}

export interface ToldLine {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

export interface ToldConversation {
  readonly messages: readonly ToldLine[];
  readonly people: ReadonlySet<string>;
}

export interface NewLine {
  readonly sender: string;
  readonly text: string;
}

export interface AnswerBounds {
  readonly characters: number;
}

export interface OverheardBounds {
  readonly lines: number;
  readonly characters: number;
}

export interface ChatRendering {
  readonly service: string;
  readonly app: string;
  readonly words: ChatWords;
  readonly instructions: readonly string[];
  readonly checkInstructions: string;
  readonly answerOf: (answer: string, bounded: boolean, people: ReadonlySet<string>, bounds?: AnswerBounds) => string;
  readonly madeSafe: (text: string, people: ReadonlySet<string>) => string;
  readonly lineWithALinkButton: (line: string, label: string, address: string) => RenderedMessage;
  readonly withoutTheApp: (text: string, app?: string) => string;
  readonly earlierIn: (
    thread: readonly WrittenInAThread[],
    asked: { readonly id: string; readonly app: string | undefined },
    most: number,
  ) => readonly EarlierInAThread[];
  readonly conversationOf: (
    earlier: readonly RememberedLine[],
    written: NewLine,
    bounds?: OverheardBounds,
  ) => ToldConversation;
}
