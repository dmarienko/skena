# Chat console redesign — design

Decided with the user on 2026-09-26/27. Visual reference: the mock at
https://claude.ai/artifact/WJHtZM965FHT43KZsL9SY6 (version 4) and the ChatGPT desktop screenshot
the user pasted on `test/H4.canvas` (C9). The mock's styles and colours are the target.

## Scope

The user's scope from 2026-09-19: a translucent surface, a rounded input bar with `+`, the model
picker and a send button, and turns as foldable units with their own actions. No file-edit card.
Everything else the chat does today stays; only its layout and look change.

## Placement

- The console is docked at the bottom centre of the canvas view. It no longer floats, and it is not
  dragged or resized freely.
- The user sets its width by dragging either side edge. The width is saved per canvas, the way the
  panel's size and position are saved today (`floatingChatSaveUIState`).
- Two parts, stacked: the conversation panel on top, the input bar below it. The conversation panel
  is inset 18 px on each side, so the input bar is wider than it.
- The conversation panel grows with its content up to 60 % of the canvas view's height, then
  scrolls.

## Look

Taken from the mock:

| Part | Background | Blur | Border | Corners |
|---|---|---|---|---|
| Conversation panel | `rgba(14, 20, 18, 0.42)` | 10 px, saturate 1.15 | `rgba(255,255,255,0.08)` | 14 px top, square at the bottom |
| Input bar | `rgba(20, 26, 24, 0.58)` | 12 px, saturate 1.15 | `rgba(255,255,255,0.08)` | 22 px |
| `+` menu | `rgba(20, 26, 24, 0.86)` | 12 px | same | 12 px |

- Accent `#7fe3b8` (send button, caret, the user's prompt line, chips), text on the accent `#062016`.
- Tool steps done `#4cc8a0`, running `#e7a93a`.
- Fonts: IBM Plex Sans for text, IBM Plex Mono for prompts, tool steps and the input. skena
  already bundles them (`src/webview/styles/fonts-ibm-plex.css`).
- Shadow under the input bar `0 10px 30px rgba(0,0,0,0.45)`.

## Input bar — always visible

- It stays on screen in every state, including when the conversation is folded.
- The editor stays Monaco, with vim mode, the clipboard relay and Ctrl+Enter to send, as today.
- It starts one line high and grows with each new line up to 8 lines (160 px), then scrolls.
- Left: a `+` button. It opens a menu with three entries:
  - nodes picked with Space (the count is shown);
  - a file from the workspace (VS Code's file picker);
  - an image from the clipboard.
  What is attached shows as chips at the start of the input. A chip has a remove control.
- Right: the model and effort picker (it replaces the "Agent: model @ name" header label and opens
  the same picker), then the send button. While the agent works, a spinner shows and the send
  button becomes Stop (the same soft abort as today).

## Conversation panel

- Header line: "Latest turn · time" and a fold arrow. The arrow, and Alt+`, fold the conversation to
  this header line; the input bar stays. Folded or open is saved per canvas.
- Turns form one scrollable list. A folded turn shows as one line: `› prompt · time`; a click folds or
  opens it. A turn is open unless the user folded it by clicking — including every turn from history
  loaded when the canvas opens. A new prompt opens the new turn and leaves every other turn exactly as
  it was.
- Inside a turn:
  - the user's prompt is one monospace line starting with `›`, in the accent colour, no bubble;
  - tool steps and thinking are compact one-line entries, as the tool cards and thinking blocks
    show today;
  - the answer is rendered markdown, as today.
- Each turn has two actions under its answer: copy the answer, and add the answer to the canvas as
  a note (connected to the focused node, as the agent's own notes are).

## Unchanged

Alt+I (focus between the input and the canvas), Alt+L, Shift+H/J/K/L scrolling the conversation
from vim normal mode, the pin-to-latest scroll, streaming, the compacting notice, and the history
kept per canvas.

## Removed

The side-by-side input column, the draggable and resizable floating panel, the collapsed bar
docked to the bottom edge (folding now keeps the input bar), and the header's "Agent: model @ name"
label (the picker moves into the input bar).

## Open, to settle while planning

- Images: the agent runs as `claude --input-format stream-json`. Whether its user messages accept
  image content blocks is not verified yet. If they do not, the clipboard-image entry is left out.
- Space-picked nodes and files as attachments: how they reach the agent (inlined into the message
  like the focused node in `context-builder.ts`, or as paths) is decided in the plan.
