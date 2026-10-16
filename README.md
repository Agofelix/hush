# Hush

**Your words. Your secrets.**

Hush is a Claude Code mod. When you press Enter, it holds the prompt and opens a review panel. In the panel you replace names, companies, addresses or IDs with placeholders of your choice, and the preview shows the exact text Claude will receive. Nothing is sent until you confirm. Cancel, and nothing is sent at all.

The replacement runs inside the mod, on your machine. Hush makes no network request, calls no model, has no file access and keeps prompts and rules in memory only; its few log lines carry counts, never text. `claude plugin validate .` lists every engine call the mod makes, and [SECURITY.md](SECURITY.md) explains what that list proves.

Both occurrences are replaced. Everything outside the matches (punctuation, case, line breaks) stays byte for byte as typed.

## Install

Hush was built and tested on Claude Code 2.1.299. The Mod API is early access: another version may refuse the module or behave differently, so run `claude plugin validate .` and `claude plugin test .` from this folder after each update.

**Install from GitHub**, at the prompt of a terminal session:

```
/plugin install hush --marketplace Agofelix/hush
```

Answer `y` to add the marketplace, then pick a scope (user is the first). Hush is active at once, with no restart.

From a shell:

```bash
claude plugin install hush --marketplace Agofelix/hush
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `Agofelix/hush`, then Add plugin.

**Try it for one session** (nothing is installed):

```bash
git clone https://github.com/Agofelix/hush
```

```bash
claude --plugin-dir hush
```

**Install from a local folder:**

```bash
claude plugin marketplace add /path/to/hush
```

```bash
claude plugin install hush@hush
```

In the desktop app, click + next to the prompt box, then Plugins, Add marketplace with the folder's path, then Add plugin.

## Uninstall

```bash
claude plugin uninstall hush@hush
```

```bash
claude plugin marketplace remove hush
```

The marketplace keeps its name, `hush`, whether you added it from GitHub or from a folder.

## Using the panel

The panel opens with the cursor in the **New keyword** field.

| Key or control | What it does |
| --- | --- |
| Tab / Shift+Tab | Moves between fields and buttons |
| Enter in a keyword field | Moves to its replacement field |
| Enter in a replacement field | Adds the rule (new row) or moves on (existing row) |
| Add rule | Adds the rule from the two New fields |
| Rule: on/off, Case: any/exact, Match: whole word/inside words | Toggle the rule's settings |
| Remove, Clear rules | Delete one rule or all of them |
| Show full preview | Shows a long preview in full (over 1,200 characters) |
| Confirm and send | Sends the anonymized text shown in the preview |
| Send original prompt | Only with `allowUnmodifiedSubmission` on; asks twice |
| Cancel, or Esc | Discards the prompt; nothing is sent |

Enter never sends the prompt from a text field. Matched segments are highlighted in the preview, with a count of replacements per rule and in total.

**When no rule matches**, the anonymized prompt is the prompt as typed. Hush never reads that as approval: the first press of Confirm shows a warning and changes the button to **Send as typed**, and only a second press sends.

**A rule with a keyword and no replacement blocks sending**, because it would leave the keyword in the prompt.

### How matching works

* Case-insensitive by default, every occurrence, whole words only (a rule for `Rossi` does not touch `Rossini`).
* Keywords are literal text: `.`, `*`, `(` and the rest are never read as patterns.
* A space inside a keyword matches any run of whitespace, so `Mario Rossi` also matches a name split across two lines.
* Accented and non-Latin letters count as letters; composed and decomposed accents both match.
* One pass over the original: a replacement is never matched again by another rule.
* Overlaps go to the leftmost match, then the longest: with `Mercedes Spa` and `Mercedes` both defined, `Mercedes Spa` wins where both start.
* Two rules with the same keyword: the first wins and the panel marks the second.

## Configuration

| Option | Default | Meaning |
| --- | --- | --- |
| `allowUnmodifiedSubmission` | `false` | Adds a **Send original prompt** button, which warns and asks for a second press. |
| `ruleScope` | `session` | `session` keeps rules in memory until the session ends; `prompt` forgets them after each prompt. |
| `reviewTimeoutMinutes` | `10` | A held prompt is discarded after this long without a decision. |

Set them with `claude plugin configure hush@hush`, or in the `/config` menu when Hush runs from `--plugin-dir`. Rules are never saved: they live in the mod's memory and are gone when the session ends or the mod reloads.

## What Hush reviews

Every prompt you type, at the terminal, in the desktop app, through Remote Control or from the SDK, and any prompt another plugin submits as your own words (`asUser`). Prompts nobody typed pass untouched: background task notifications, scheduled tasks, messages from other sessions or agents, channel relays and other plugins' framed messages.

Hush blocks, with a message saying why:

* prompts with pasted images or documents (it cannot anonymize them);
* slash commands with arguments (a bare `/command` runs normally);
* a second prompt while one is under review;
* any prompt in a session with no terminal or desktop surface to show the panel (`claude -p`, an SDK host without a UI, VS Code today).

## Supported surfaces

| Surface | Status |
| --- | --- |
| Terminal, interactive | Supported. Panel docked beside the transcript from 110 columns in fullscreen, inline above the prompt otherwise |
| Claude desktop app | Supported (same panel, desktop controls) |
| Mobile, Remote Control | No text fields there: the panel offers only to discard. Review from the terminal or desktop |
| VS Code extension | Not supported: it attaches no surface today, so Hush blocks every prompt |
| `claude -p`, SDK without a UI | Every reviewed prompt is blocked |

The panel's trees are checked against the terminal, desktop and mobile element tables by the test kit. How they look and how focus moves on a real screen still needs the manual check below.

## Development

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

```bash
tsc -p .
```

`tsc` needs TypeScript 5.4 or later and the API types in `.claude-plugin/types/`, which Claude Code writes the first time it loads the mod from this folder (for instance through `--plugin-dir` in an interactive session). The package declares no dependencies.

Layout:

* `hooks/register.tsx`: the hooks (interception, the panel, the queue record, timers).
* `src/core/replacement-engine.ts`: the pure replacement engine.
* `src/core/rule-validator.ts`: rule checks (incomplete, duplicate, conflicting rules).
* `src/core/submission-state.ts`: the state machine (IDLE, INTERCEPTED, REVIEWING, CONFIRMED, CANCELLED, BLOCKED, ERROR).
* `src/core/privacy-controller.ts`: everything sensitive Hush holds, and the decisions.
* `src/ui/`: the panel, the rule editor and the preview.
* `tests/`: engine, controller and end-to-end tests with a fake downstream boundary.

### Manual integration check

1. Start an interactive terminal session at 110 columns or more: `claude --plugin-dir /path/to/hush`.
2. Type the example prompt above and press Enter. Expect the line "Hush is holding this prompt for review" and the panel.
3. Add `Mercedes` replaced by `[Cliente]`. Expect "2 replacements from 1 rule" and both occurrences highlighted.
4. Press Confirm and send. Expect "Hush: sent the anonymized prompt (2 replacements)" and a prompt row containing `[Cliente]`.
5. Send another prompt, press Esc. Expect "Hush discarded the prompt. Nothing was sent."
6. Look for the keyword in the session's transcript. Expect no match:

```bash
grep -c Mercedes ~/.claude/projects/*/<session-id>.jsonl
```

## Known limitations

Read [SECURITY.md](SECURITY.md) before relying on Hush. In short: plugins seated above Hush see the original prompt and can change what Hush sends; the terminal's prompt history may keep what you typed; Hush covers the prompt only, not files or tool output Claude reads afterwards; the anonymized prompt is submitted by Hush itself, so `@file` mentions are not expanded and a prompt typed during a turn runs after it.

## License

MIT, see [LICENSE](LICENSE).
