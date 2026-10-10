# Issue tracking for agents

This repository is public. Work is tracked in a **private Linear project, `threejs-worldgen`** (team key `ASK`), not in
GitHub issues, so nothing sensitive from conversations ends up in public. A `UserPromptSubmit` hook
(`.claude/hooks/issue-tracking-reminder.sh`) reminds the agent of this on every prompt.

## Conversation tracking

Nothing the user raises lives only in the conversation.

**What gets an issue:** every bug the user reports, every feature or design proposal, every rule or invariant they
state, and every bug you discover while working. A decision that changes a spec is a comment on the issue it belongs to
(plus the spec edit), not a new issue. A question becomes an issue only once the user wants the work done.

**When:** in the same reply the thing comes up, including work you are fixing right now. Before ending a reply, check
whether anything new was raised and file or update it.

**Keeping it current:** the body is always the current summary: the user's words quoted verbatim under **Reported**,
then cause, decisions, repro and acceptance criteria. Each new detail is a dated comment, and the body is revised to
match. Search first (Linear `list_issues` with `query`, `project: threejs-worldgen`) and update rather than duplicate.

**No confirmation before filing.** End every reply that touches the tracker with
`Tracked: ASK-n (few-word description, new), ASK-m (…, updated)`, so the user never has to look a number up.

**Keep private things private:** never copy Linear URLs, issue bodies, tokens, personal data or anything else from the
tracker into commits, pull requests, code comments or docs in this repo. Mentioning an `ASK-n` identifier in chat is
fine; in the repo, describe the change itself instead.

## Hierarchy

| Level | Representation |
|---|---|
| Milestone | Linear project milestone (`M1 — Worlds`, `M2 — Docs, landing pages and releases`, `M3 — Characters`, `M4 — Simulation and style`) |
| Epic | issue labelled `Epic` in a milestone: one outcome |
| Story | issue labelled `Story`, "As a … I want … so that …" plus acceptance criteria; child (`parentId`) of an epic |
| Task | issue labelled `Task`: non-user-facing work (investigation, docs, harness); child of a story or epic |
| Bug | `Bug`, child of the story or epic whose behaviour it breaks |

Each issue also carries one category label (`Feature`, `Bug`, `Improvement` or `Documentation`), plus
`ready-for-agent` when fully specified or `needs-info` when the cause or design is open. Record ordering constraints with
Linear's `blockedBy` / `blocks` relations.

## Working a milestone

When several tickets in the current milestone are independent (no open blockers, disjoint packages or files), hand them
to parallel subagents, one ticket each; keep coupled tickets and anything touching the same files sequential. Shared
monorepo files (root `package.json`, `tsconfig.json`, `typedoc.json`, `example/vite.config.ts`) are edited by the
coordinating agent only.

## Obsidian fallback

If Linear is unreachable, append the same content to the private Obsidian vault note `threejs-worldgen/Tracker.md` and
copy it into Linear once it's back.
