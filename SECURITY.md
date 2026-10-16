# Security model

Hush keeps the text you list out of the prompt Claude receives. It is not data loss prevention: it replaces only what your rules name, and it covers the prompt you type, nothing Claude reads later.

Everything below was established on Claude Code 2.1.299. The Mod API is early access, so re-run the checks in "How to re-check" after any update.

## The lifecycle

1. You press Enter. Claude Code raises `prompt.submit`.
2. Hush answers `{ drop }` at once. Nothing enters the session: no conversation row, no turn, no hook beneath Hush, no `UserPromptSubmit` settings hook sees the text.
3. The original stays in the memory of Hush's hooks module, in one place (`Submission` in `src/core/submission-state.ts`).
4. Hush opens its panel. You edit rules; the preview is computed locally.
5. On confirmation Hush moves the submission to `CONFIRMED`, drops its reference to the original, and submits the anonymized text with `$.prompt.submit({ text, asUser: true })`. That text is the same string the preview showed.
6. On Cancel, Esc, timeout, session end, a lost panel or any error, the submission ends `CANCELLED`, `BLOCKED` or `ERROR` and the original is dropped. Nothing is submitted.

Why not hold the prompt inside the hook and call `next({ ...e, text })`? A hook has 10 seconds of its own time per dispatch; the clock stops only while a `next` or `$` call is pending. The one `$` call that waits for a person is `$.ui.ask`, the engine's multiple-choice dialog, which cannot host a rule editor without sending keywords through `PreToolUse`/`PostToolUse` settings hooks. Dropping and resubmitting keeps the editor inside Hush and the original out of every hook beneath it.

## Where the original text can be

| Place | Original text? | Evidence |
| --- | --- | --- |
| Anthropic's API | No. Only the anonymized text, or the original if you choose **Send original prompt** (off by default, asks twice) | Integration tests; headless run (0 turns, 0 API time) |
| Plugins and settings hooks beneath Hush | No | Integration tests: the downstream boundary never receives the canary |
| Conversation rows in the session transcript (`~/.claude/projects/.../<session>.jsonl`) | No | Headless run: no row for the dropped prompt |
| Message queue record (`queue-operation` in the same file) | No: Hush empties it | Headless run: holds the canary without the `session.append` hook, empty with it |
| Debug log (`~/.claude/debug/`) | No | Headless run: canary absent |
| Terminal prompt history (`~/.claude/history.jsonl`) | Probably yes. The prompt box records what you typed; the Mod API does not reach it | Not verified |
| Hush's own memory | Yes, until the prompt reaches a final state | By design |
| Plugins seated above Hush | Yes, and they can change the text Hush submits | Integration test (`plugins seated above Hush`) |
| Other plugins hooking `ui.input` | Keywords as you type them | By the API: every plugin may hook `ui.input` |
| `$.state` | No: only a redraw counter, since any plugin can read `$.state` | Contract in `types/index.d.ts`; `claude plugin validate .` |
| The screen | What you type is on screen while you type it | Inherent |

## What is proven, and how

**Statically, by `claude plugin validate .`** The validator reads the module the way the engine loads it and lists every engine call it makes. For 0.1.0: `$.clock.after`, `$.prompt.submit`, `$.session.surfaces`, `$.state.get`, `$.state.set`, `$.ui.close`, `$.ui.focus`, `$.ui.log`, `$.ui.open`, `$.ui.panes`, `$.ui.resolve`, `$.ui.status`, `$.ui.toast`. There is no `$.http`, `$.model`, `$.fs`, `$.store`, `$.process`, `$.mcp`, `$.agent` or telemetry call, and a hooks module has no other way out: it runs with no Node, no DOM and no network of its own.

**By unit tests** (`tests/replacement-engine.test.ts`, `tests/privacy-controller.test.ts`):

* every case in the brief: single and repeated keywords, several rules, case-sensitive and insensitive, whole words, accents, composed and decomposed forms, other scripts and astral characters, overlaps, duplicates, conflicts, empty fields, whitespace, line breaks, regular expression characters, placeholders already in the text, a 1 MB prompt;
* a property test over 400 random cases against an independent reference matcher: no occurrence of an applied keyword survives whole;
* the state machine allows only its documented moves, each submission reaches one final state, and reaching it drops the original;
* a confirmation sends once; a second press finds nothing to send;
* error messages never quote the prompt.

**By integration tests** (`tests/integration.test.ts`, run by `claude plugin test` on the engine's own dispatch). A fake downstream `prompt.submit` hook stands where the prompt leaves for the model, and a synthetic canary (`Zq7Canary`) must never reach it. Covered: interception, delayed confirmation, confirmation on the terminal and desktop tables, a double press, session rules, Cancel, Enter in an empty field, the zero-replacement double confirmation, incomplete rules, the original-prompt option on and off, a second prompt during review, the timeout, a lost panel, a panel that cannot be placed, no usable surface, a failing lookup inside the hook, session end, attachments, slash command arguments, another plugin's `asUser` prompt, pass-through origins, the queue record, narrow panes and long prompts.

Four deliberate mutations were run against the suite. Passing the original through, sending the original on confirm and failing open on errors are each caught. Removing the approval check survives, as it should on this build: 2.1.299 never runs Hush's hook on the prompt Hush submits, so that check is a guard for later builds, covered by unit tests only.

**By one real headless run** (`claude -p --plugin-dir`, Claude Code 2.1.299, a unique canary). Hush dropped the prompt (no surface to review on), the run reported 0 turns, 0 ms of API time and 0 USD, and no file under `~/.claude` contained the canary.

## Assumptions not yet verified

* The panel's look, focus and Tab order on a real terminal and in the desktop app. The test kit validates the trees, not the paint.
* Esc closing the panel raises `ui.close` with origin `person`, which Hush treats as Cancel. The test kit cannot raise that event; the code path is reviewed, not tested.
* The prompt box is empty after the drop, so the panel's focus request is granted. If not, click the panel or press ctrl+x tab.
* What the terminal's prompt history keeps for a dropped prompt.
* The origin the desktop app gives to typed prompts. Every origin not on the pass-through list is reviewed, so an unexpected one is held, not passed.
* The order of plugins within the same tier.
* A reload of the module during the milliseconds between Enter and the drop. During development only.
* Claude Code 2.1.299 never runs Hush's `prompt.submit` hook on the prompt Hush itself submits. Should a later build do so, Hush lets through only the exact approved text, once.

## Fail-closed behaviour

The `prompt.submit` hook carries a `.catch` that answers `{ drop }` whenever the hook throws, times out or returns a wrong shape. Hush also drops, with a reason on screen, when: no terminal or desktop surface is attached; the panel cannot be placed; the submission was interrupted; another prompt is under review; the prompt has attachments; a slash command has arguments. By reading of the code, not by a test: a panel that fails to draw discards the held prompt, and the queue-record hook empties the record even when it fails.

## Not covered

* Files, tool results and anything else Claude reads after the prompt. Hush sees the prompt only.
* Pasted images and documents (blocked), slash command arguments (blocked).
* Text in other channels: memory files, `CLAUDE.md`, skills, MCP servers.
* Matching beyond simple case folding: `ß` does not match `SS`; whole-word mode treats a run of Chinese or Japanese characters as one word, so use "inside words" there.
* Wiping memory. JavaScript cannot overwrite a string; Hush drops its references and leaves the rest to the collector.

## Deployment advice

Plugins loaded above Hush see the original prompt. Review the other plugins you run. An administrator can list Hush as a managed plugin in the `prepend` tier, the outermost of the chain, which leaves only other `prepend` plugins above it.

## How to re-check

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

Then repeat the headless run with a fresh canary and search for it:

```bash
claude -p --plugin-dir . "The client is HushCanary12345 Spa."
```

```bash
grep -rlF HushCanary12345 ~/.claude
```

## Reporting a vulnerability

Open a private security advisory at https://github.com/Agofelix/hush/security/advisories/new. Do not put real secrets in the report: describe them, or use a synthetic canary.
