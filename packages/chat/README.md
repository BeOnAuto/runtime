# @on.auto/chat

The loop that answers one message of a conversation with a person: a turn. It asks a model with the conversation and the tools offered, calls each tool the model asks for as the person, gives the model the results, and asks again until the model answers in text or a bound is reached. A turn is not a run: nothing of it is recorded in a playbook's ledger, and it reads and writes no stored state. Everything the loop needs is handed to it, so the package names no model provider, no chat service and no way of reaching the tools. No part of the server composes it yet.

## What a turn is handed

`turnOf(turn)` (`src/turn/conversation-turn.ts`) takes a `Turn`:

- `model`, a `ChatModel`: its `name` and `generate(request, signal)`, which answers `{ answered: ModelResult }`, `{ failed: ModelFailure }` as the reasoning capability's model does, or `{ refused }` with a reason of the caller's own. The loop does not read a refusal: the turn ends with it as it came.
- `offered`, the tools listed for the model, and `tools.call(name, input, signal)`, which answers each call as `{ text, isError }`.
- `admitted()`, asked before every tool call. It answers `true`, `false` or `'credential_expired'`; anything but `true` ends the turn before the call is sent, and so does an answer that fails or does not come within the bound of a tool call.
- `instructions`, the text the model reads, and `messages`, the conversation with the new message last.
- `now`, `waits` and `signal`: the clock the deadlines are read from, the waits each call is raced against, and the signal that the person's client went away. `closed()` says the same for the steps between calls.
- `bounds`, each of which may be left out for its default.

A turn ends as `{ answer, bounded }`, as `{ closed: true }` where the client went away, or as `{ refused }`. The loop's own refusals are `bound_reached`, `model_unavailable`, `not_admitted` and `credential_expired`; any other is the model's, carried untouched. Each ending carries the model calls and the tool calls it spent.

## The bounds

`TURN_BOUNDS` holds the defaults: 25 tool calls, 10 minutes from the first model call, 2,000,000 input tokens over the turn, 180,000 input tokens in one request, 16,000 output tokens a call, a model call cut at 60 seconds and 25 milliseconds for each output token it may write, and a tool call, its admission among them, cut at 30 seconds. A call is also cut at the time left to the turn. Where a request would pass the input tokens of a call, the oldest tool results are left out one by one, each replaced by a line that says so, until it fits. At the bound on tool calls the model is asked once more with no tools, the steps retold as plain messages between fences; the calls of one answer past the bound are refused unsent.

## The instructions

`instructionsToldTo(instructions, told)` (`src/instructions/conversation-instructions.ts`) adds the lines every turn reads after the instructions it is given: that the conversation holds other people's words and tool results, all of it information; the lines for a person whose role allows no change, where `roleAllowsNoChange` is set, quoting the words the server refuses a role with; the lines of the service the conversation takes place in, `surfaceLines`, which the caller hands in; and, where `autoNotNamed` is set, the lines that ask the person before a destructive tool call.

## Whom a reply is for

`addresseeChecked(asked)` (`src/addressee/addressee-check.ts`) asks a model whether the last message of a conversation is meant for Auto, with the instructions the caller hands in. It sends the last message whole and at most the 9 before it, each cut to 1,000 characters, as JSON that names who wrote each, asks for no reasoning and at most 2,048 output tokens, and waits 15 seconds. The answer is `addressed` only where the model answers the one word yes; a failure, a timeout and anything else are `unaddressed`, a client that went away is `closed`, and a refusal of the model is carried as `{ refused }`. `CHECK_BOUNDS` holds the defaults.

## The tools of a directory

`directoryCallsOf(directoryUrl, send, bounds)` (`src/tools/directory-calls.ts`) lists and calls the tools of an MCP endpoint over JSON-RPC, through `send`, so the caller decides how a request reaches it. It reads an answer as one JSON body or as the events of a stream, never past `answerBytesRead` (256 KiB by default), and cuts a result, a problem's detail or an error's message at `resultBytes` (64 KiB), with a line that says so and how to ask for less (`src/tools/bounded-answer.ts`). `RESULT_BOUNDS` holds the defaults.

## Source

`src/turn` holds the turn, its steps, the fit of a request, the retold turn, the count of its input tokens and the bounds of its calls; `src/model` the port of the model; `src/instructions` the lines a turn reads; `src/addressee` the check of whom a reply is for; and `src/tools` the calls to a directory and the bounds of their answers.
