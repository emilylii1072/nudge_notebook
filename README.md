# Nudge Notebook

A notebook editor with Claude beside it. You run cells in the page, and Claude edits the notebook file directly, runs cells, and reports what it changed, much like Claude in the terminal. A nudger sits between your message box and Claude and checks how actively you are taking part.

## Run it

You need Node.js 22 or newer and a Python with `jupyter_client` and `ipykernel`.

```sh
npm install
cp .env.example .env     # then put your ANTHROPIC_API_KEY in .env
npm run dev
```

Open the address Vite prints. By default the app works in the sibling folder `nudge-test-workspace`. Set `NUDGE_WORKSPACE` in `.env` to use another folder, and `NUDGE_PYTHON` to choose the Python that runs cells.

Claude itself runs through the Claude Agent SDK, so it uses your Claude Code login. The `ANTHROPIC_API_KEY` is only for scoring your messages.

## How it works

- **The file is the notebook.** The page, the kernel and Claude all read and write the same `.ipynb`. The page watches the file, so Claude's edits appear as they happen, and cells it changed are marked until you dismiss them.
- **Claude's tools.** Read, Edit, Write, NotebookEdit, Glob, Grep, and `run_cell`, which runs a cell in the notebook's kernel. There is no shell. Cells are locked while Claude works so you and it do not edit the same cell.
- **Running cells.** `scripts/kernel-sidecar.py` holds one live Jupyter kernel per notebook, so variables stay between cells.

## The nudger

Every message you type is scored from 0 (passive) to 3 (interactive) on the ICAP scale, using the rubric in `src/lib/server/prompt-scoring/icap-rubric.md`.

These are the same interventions, with the same wording, as the nudge plugin for the terminal (`../nudge-hook`).

- Before sending, a passive message while your average is below 1.5 is held back. A dialog offers "Send as it is" or "Write my own", and shows a random sentence starter. If you write your own, the starter is put in the message box.
- After sending, a popup with three sentence starters appears if your last two messages average below 1.5. Popups go away after 12 seconds.
- After 5 minutes without a message, a popup suggests telling Claude what should happen next, with three sentence starters.
- If Claude has been working for more than a minute, a dialog asks "While Claude works: what is the task you are doing?". Your answer is saved as a `question` event.
- The scorer reads your new message together with your last 5 exchanges, using the same rubric (`icap-rubric.md` is a copy of the plugin's `rubric_with_history.md`). A message is scored as pasted when most of it repeats Claude's replies.
- Scoring never blocks sending. If it fails, the message goes through.

Every scored message, warning and nudge is saved to `data/prompt_events.jsonl`. Download it as a CSV from the "Download log" link.

The rules are in `src/lib/shared/engagement.ts`, and the browser side is `src/lib/nudger.ts`.

## Checks

```sh
npm run check
npm test
```
