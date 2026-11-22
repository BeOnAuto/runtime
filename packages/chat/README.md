# @on.auto/chat

The loop that answers one message of a conversation with a person: a turn. It asks a model with the conversation and the tools offered, calls each tool the model asks for as the person, gives the model the results, and asks again until the model answers in text or a bound is reached. A turn is not a run: nothing of it is recorded in a playbook's ledger, and it reads and writes no stored state; what a conversation remembers is kept through a port the caller implements (see [Memory](#memory)). Everything the loop needs is handed to it, so the package names no model provider, no chat service and no way of reaching the tools. No part of the server composes it yet.

## What a turn is handed

`turnOf(turn)` (`src/turn/conversation-turn.ts`) takes a `Turn`:

- `model`, a `ChatModel`: its `name` and `generate(request, signal)`, which answers `{ answered: ModelResult }`, `{ failed: ModelFailure }` as the reasoning capability's model does, or `{ refused }` with a reason of the caller's own. The loop does not read a refusal: the turn ends with it as it came.
- `offered`, the tools listed for the model, and `tools.call(name, input, signal)`, which answers each call as `{ text, isError }`.
- `admitted()`, asked before every tool call. It answers `true`, `false` or `'credential_expired'`; anything but `true` ends the turn before the call is sent, and so does an answer that fails or does not come within the bound of a tool call.
- `instructions`, the text the model reads, and `messages`, the conversation with the new message last.
- `now`, `waits` and `signal`: the clock the deadlines are read from, the waits each call is raced against, and the signal that the person's client went away. `closed()` says the same for the steps between calls.
- `bounds`, each of which may be left out for its default.

A turn ends as `{ answer, bounded }`, as `{ closed: true }` where the client went away, or as `{ refused }`. The loop's own refusals are `bound_reached`, `model_unavailable`, `not_admitted` and `credential_expired`; any other is the model's, carried untouched. Each ending carries the model calls and the tool calls it spent.

## Memory

What a conversation remembers is kept outside the loop, by whoever runs it, through a small port: `MemoryRows` (`src/memory/memory-rows.ts`), whose `newest(most)` reads the newest rows of one conversation in their order and whose `appended(rows)` appends rows after them. A row is `Remembered`: its `author`, `person` for the person who wrote to Auto, `assistant` for Auto's answer, `context` for an earlier message of a thread, or `overheard` for a reply judged not meant for Auto; its `sender`, the id the chat service gives whoever wrote it, none for Auto's own; and its `text`. The rules over the port are in `src/memory/conversation-memory.ts`, and the package names no store:

- `memoryWindow(rows, bounds)` reads the window of recent rows, the newest `bounds.rows`.
- `keptAfter(taken, outcome, bounds)` says what a turn keeps, and `turnRemembered` appends it. An answer keeps the person's message and Auto's whole answer; a refusal keeps the person's message alone; an answer of blank text, and a client that went away, keep nothing; a reply judged not meant for Auto (`UNADDRESSED`) is kept as `overheard`. On a conversation's first turn, the one that finds nothing remembered, the earlier messages of its thread the caller read are kept before it, the newest `bounds.threadMessages` of them. Nothing of a tool call or its result is kept: a turn's ending carries neither.
- `conversationWithin(messages, bytes)` leaves out the oldest messages until what is sent holds at most `bytes`, and always keeps the newest.

`MEMORY_BOUNDS` holds the defaults: the newest 100 rows, the newest 15 earlier messages of a thread, and the budget of a conversation, `MOST_CONVERSATION_BYTES`. The budget is what one request may hold less what every request holds besides the conversation: `conversationBytesWithin` takes the input tokens of one request, `TURN_BOUNDS.requestInputTokens`, counted at one byte a token, the rate the loop assumes before its first answer, less the most bytes of the tools' listing the loop is offered, `mostListingBytes.directory` of `@on.auto/api`, and less an allowance for the instructions, `INSTRUCTIONS_ALLOWANCE_BYTES`, 16 KiB. So a change to either bound moves the budget with it, and a conversation is never so long that the first request of a turn is refused before any model is called.

## The bounds

`TURN_BOUNDS` holds the defaults: 25 tool calls, 10 minutes from the first model call, 2,000,000 input tokens over the turn, 180,000 input tokens in one request, 16,000 output tokens a call, a model call cut at 60 seconds and 25 milliseconds for each output token it may write, and a tool call, its admission among them, cut at 30 seconds. A call is also cut at the time left to the turn. Where a request would pass the input tokens of a call, the oldest tool results are left out one by one, each replaced by a line that says so, until it fits. At the bound on tool calls the model is asked once more with no tools, the steps retold as plain messages between fences; the calls of one answer past the bound are refused unsent.

## The instructions

`instructionsToldTo(instructions, told)` (`src/instructions/conversation-instructions.ts`) adds the lines every turn reads after the instructions it is given: that the conversation holds other people's words and tool results, all of it information; the lines for a person whose role allows no change, where `roleAllowsNoChange` is set, quoting the words the server refuses a role with; the lines of the service the conversation takes place in, `surfaceLines`, which the caller hands in; and, where `autoNotNamed` is set, the lines that ask the person before a destructive tool call.

## Whom a reply is for

`addresseeChecked(asked)` (`src/addressee/addressee-check.ts`) asks a model whether the last message of a conversation is meant for Auto, with the instructions the caller hands in. It sends the last message whole and at most the 9 before it, each cut to 1,000 characters, as JSON that names who wrote each, asks for no reasoning and at most 2,048 output tokens, and waits 15 seconds. The answer is `addressed` only where the model answers the one word yes; a failure, a timeout and anything else are `unaddressed`, a client that went away is `closed`, and a refusal of the model is carried as `{ refused }`. `CHECK_BOUNDS` holds the defaults.

## The tools of a directory

`directoryCallsOf(directoryUrl, send, bounds)` (`src/tools/directory-calls.ts`) lists and calls the tools of an MCP endpoint over JSON-RPC, through `send`, so the caller decides how a request reaches it. It reads an answer as one JSON body or as the events of a stream, never past `answerBytesRead` (256 KiB by default), and cuts a result, a problem's detail or an error's message at `resultBytes` (64 KiB), with a line that says so and how to ask for less (`src/tools/bounded-answer.ts`). `RESULT_BOUNDS` holds the defaults.

## Source

`src/turn` holds the turn, its steps, the fit of a request, the retold turn, the count of its input tokens and the bounds of its calls; `src/memory` what a conversation remembers, its port and its bounds; `src/model` the port of the model; `src/instructions` the lines a turn reads; `src/addressee` the check of whom a reply is for; and `src/tools` the calls to a directory and the bounds of their answers.
