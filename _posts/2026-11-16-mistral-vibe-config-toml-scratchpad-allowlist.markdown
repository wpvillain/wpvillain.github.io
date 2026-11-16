---
layout: post
title: "My ~/.vibe/config.toml After Months of Daily Vibe: The Scratchpad Allowlist Fix and Every Default I Changed"
seo_title: "Mistral Vibe config.toml: scratchpad allowlist + permission setup"
description: "Vibe prompted on every shell command that touched my scratchpad, so I found where the scratchpad really lives, allowlisted it with vibe-path entries, diffed my whole config.toml against Mistral's configuration reference, and raised the read/write byte caps after an 80 KB single-file HTML sheet refused the 64 KB write limit."
date: 2026-11-16 09:00:00 +0700
categories: vibe ai devops
tags: [vibe, mistral, ai, ai-agents, config, permissions, allowlist, scratchpad, cli, smart-approve, mcp]
case_category: ai
case_status: documented
---

I run [Mistral Vibe](https://docs.mistral.ai/vibe/code/overview) as my daily coding agent, on top of a `~/.vibe/config.toml` I have been tuning since I installed it. Last week one command — an `ls -d` probing four candidate scratchpad paths — came back with four "outside workdir" approval entries in a single dialog. That was the nudge to sit down and diff my whole config against the [official configuration reference](https://docs.mistral.ai/vibe/code/cli/configuration-reference), fix the gaps, and write down what each setting is for. This post is that diff.

## The prompt that started this

Vibe's safety model is layered: agents decide *how often* it asks, per-tool permissions decide *what* it asks about, and the `outside_workdir` boundary asks about any path outside the working directory. The reference lists `outside_workdir = "ask"` as the default, and that is exactly what bit me: the shell tool checks every path literally written in a command, so `ls -d ~/.vibe/scratchpad ~/.scratchpad /tmp/scratchpad ~/scratchpad` prompted for each one (`/tmp/scratchpad` survived only because `/private/tmp` is allowlisted; `/dev/null` and the standard streams never count). Only allowlisted paths and `--add-dir` directories skip the check.

The subtle part: the file tools (`read_file`, `write_file`, `edit`) treat the session scratchpad as always allowed — there is a special case for it, first in the resolution order. The `bash` tool has no such special case. That asymmetry is why the scratchpad tool itself never prompted, but every shell command against it did.

## Where the scratchpad actually lives

I assumed `~/.vibe/scratchpad`. It does not exist — `ls` says so. To find the real one I wrote a probe file (`probe-scratch-location.txt`) through the scratchpad tool and then ran `find` for it:

```bash
find /Users/user-name/.vibe/logs/session -name "probe-scratch-location.txt"
# /Users/user-name/.vibe/logs/session/unified/de0265a1-.../scratchpad/probe-scratch-location.txt
```

The scratchpad is **per-session**: `~/.vibe/logs/session/unified/<session-id>/scratchpad/`. The session id changes every run, so an exact allowlist entry on one session's scratchpad would break the next day. The entry has to go on the parent directory.

## The fix

Two `vibe-path` entries, added to both `[tools.bash]` and `[tools.read_file]` (the same directories are allowlisted in both, which is the pattern I follow throughout the file):

```toml
[tools.bash]
allowlist = [
    "vibe-path:directory_recursive:/Users/user-name/code",
    "vibe-path:directory_recursive:/Users/user-name/.config/valet/Sites",
    "vibe-path:directory_recursive:/Users/user-name/Desktop",
    "vibe-path:directory_recursive:/private/tmp",
    "vibe-path:exact:/Users/user-name/.vibe/config.toml",
    "vibe-path:directory_recursive:/Users/user-name/.vibe/scratchpad",
    "vibe-path:directory_recursive:/Users/user-name/.vibe/logs/session/unified",
    # ... command prefixes below
]
```

Three deliberate choices in there:

- **`logs/session/unified`, not `logs/session`.** The legacy `session_*` transcript directories sit next to `unified/` and stay behind the prompt; only the unified per-session area — scratchpads and session metadata — is opened up.
- **`~/.vibe/scratchpad` stays in the list** even though it doesn't exist: it's the path everyone (including agents) guesses first, and the entry costs nothing.
- **Not all of `~/.vibe`.** That directory holds `.env` with API keys. Vibe asks before any tool reads `.env`/`.envrc` even at `permission = "always"`, and my `[tools.read_file]` denylist additionally blocks `**/.env`, `**/*.pem`, `**/id_rsa*`, `**/.ssh/**`, `**/.aws/**`, `**/*credentials*`, `**/*secret*`, `**/*apikey*` (the denylist is checked before the allowlist, so it wins). `config.toml` and `skills` get *exact* entries instead, so the agent can read and tune its own config without a prompt without opening the whole home of Vibe.

The other directory entry worth naming is `~/.config/valet/Sites` — where [Valet](https://laravel.com/docs/valet) parks my local WordPress dev sites. Allowlisting it means Vibe can read and edit those local projects without a prompt, same as `~/code`. Development only: production sites are reached through wp-ops over SSH, never through a filesystem allowlist.

Two honest caveats. First, `directory_recursive` on `unified` means bash can reach *every* session's scratchpad, not just the current one — one old scratchpad still holds a test-creds `.env` file, which `read_file` refuses but a plain `cat` through bash does not. So the working rule is: no secrets in the scratchpad. Second, config edits are picked up live — right after the edit, `ls` and `cat` against the scratchpad ran with zero prompts; `/reload` applies a change too, no restart needed. I wrote a `config.toml.bak` next to the file before touching it, and I keep doing that.

## The permission shape: file tools open, shell guarded

With the directories allowlisted, the remaining question is which *tools* prompt:

- `read_file`, `write_file`, `edit`, `grep`, `todo` are all `permission = "always"`. They are file tools; the dangerous boundary is the filesystem edge, and that is covered by the allow/denylists and the outside-workdir check, not by asking every time. `[tools.read_file]` carries the same directory allowlist as bash — including the Valet sites and the scratchpad entries — plus a denylist for secret files, and the denylist is checked before the allowlist, so it always wins:

```toml
[tools.read_file]
permission = "always"
allowlist = [
    "vibe-path:exact:/Users/user-name/.vibe/config.toml",
    "vibe-path:directory_recursive:/Users/user-name/code",
    "vibe-path:directory_recursive:/Users/user-name/.config/valet/Sites",
    "vibe-path:directory_recursive:/Users/user-name/Desktop",
    "vibe-path:directory_recursive:/private/tmp",
    "vibe-path:directory_recursive:/Users/user-name/.vibe/scratchpad",
    "vibe-path:directory_recursive:/Users/user-name/.vibe/logs/session/unified",
    # ... plus the aludra/* glob and two exact wp-vibe-toolbox files
]
denylist = [
    ".env", "**/.env", "**/.env.local", "**/.env.production", "**/.env.development",
    "**/.env.test", "**/*.pem", "**/id_rsa*", "**/.ssh/**", "**/.aws/**", "**/.kube/**",
    "**/*credentials*", "**/*secret*", "**/*apikey*", "**/*api-key*",
]
max_read_bytes = 200000
```
- `bash` is `permission = "ask"`, with an allowlist of about seventy command *prefixes*. The reference notes the allowlist replaces the default list, so mine re-adds the read-only defaults explicitly (`ls`, `cat`, `grep`, `git status`, `git diff`, `gh pr view`, ...) plus the commands my workflow actually uses (`wp option get`, `wp plugin list`, `npx phpcs`, `vendor/bin/phpcs`, `php -l`, `jq`, `node …/measure.mjs`, `python3 -m http.server 8765`).
- The `denylist` blocks the things I never want auto-approved: `sudo`, `rm -rf` and its flag permutations, `git push --force` / `-f`, `git reset --hard`, `git clean -fd`, `git branch -D`, `sed -i`, `dd if=`, `chmod -R`, `shutdown`, `reboot`, interactive shells (`bash -i`, `tmux`, `screen`) and editors (`vim`, `nano`, `emacs`).
- `denylist_standalone` closes the sidestep: bare `python`, `python3`, `bash`, `sh`, `nohup`, `su` are refused as standalone commands, so the agent can't route around the allowlist with `python3 -c`; it has to use an allowlisted wrapper (`jq` for JSON, `php -l` for lint only). That lesson came out of the bakery demo build — see [that post]({% post_url 2026-11-13-mistral-vibe-large-4-bakery-demo-block-theme-lessons %}), lesson 5.
- `[tools.bash]` also sets `default_timeout = 120` (six chained `magick` slices once got killed at the 30s default) and `max_output_bytes = 16000`; `[tools.grep]` has `exclude_patterns` for `node_modules/`, `.git/`, `dist/` and friends plus `codeignore_file = ".vibeignore"`; `[tools.write_file]` sets `create_parent_dirs = true` and `max_write_bytes = 200000` (more on that next).

## The 64 KB caps, and the 80 KB sheet that ran into them

The single-file exercise sheets I build for the Cambridge practice site are deliberately self-contained — inline CSS, inline JS, no build step — so one HTML file lands around **80 KB** the moment the sheet has five or six sections. `write_file` refused it outright: `Content exceeds 64000 bytes limit`. That limit is not a sandbox law, it is a per-tool setting in my own `config.toml` — `max_write_bytes = 64000` under `[tools.write_file]`, with a matching `max_read_bytes = 64000` under `[tools.read_file]` (so reading the finished 80 KB sheet back would have truncated at 64 KB too).

The fallback I used before touching the config is worth knowing: `bash` heredocs. Write the head with `cat >`, append the rest in ~20 KB `cat >>` chunks (quoted `<<'EOF'` so nothing expands), then verify with `wc -c` and `tail`. It works from any session, managed or not — but it is a workaround you should not need on your own machine, and splitting an 80 KB hand-authored file into chunks is exactly where content gets lost.

So the two lines I changed, after the usual `config.toml.bak`:

```toml
[tools.write_file]
max_write_bytes = 200000

[tools.read_file]
max_read_bytes = 200000
```

200 KB covers any single-file artifact in these projects with headroom to spare; if I ever hand the agent a monorepo lockfile to write whole, the number goes up again. Same as the allowlist changes above, `/reload` applies it — no restart needed — but the sheet I was already building that session still went out in heredoc chunks, because the write happened before the config change.

## Agent, classifier model, and the model presets

Against the reference defaults:

| Key | Reference default | My `config.toml` | Why |
| --- | --- | --- | --- |
| `default_agent` | `"accept-edits"` | `"smart-approve"` | a classifier runs each tool call and approves the safe ones; risky ones still prompt. It is not a sandbox — the docs are explicit about that — but for day-to-day work it removes most of the noise |
| `outside_workdir` | `"ask"` | `"ask"` (unchanged) | I open specific paths through the allowlists instead of moving the boundary |
| `system_prompt_id` | `"cli"` | `"cli"` | unchanged |
| `enable_update_checks` | `true` | `true` | unchanged |
| `active_model` | unset | `"mistral-large-4-0-3"` | pins the session to Large 4 |
| `skill_paths` | unset | `".claude/skills"`, `"~/code/wp-vibe-toolbox/skills"` | the [wp-vibe-toolbox](https://github.com/imagewize/wp-vibe-toolbox) skills load in every project |

The classifier matters as much as the agent: `[utility_models] smart_approve = "devstral-small"` sends the per-call classification to a cheap small model instead of letting the session model judge itself, which the reference allows but which costs real tokens on every call. The `[[models]]` presets also include a local `llamacpp` `devstral` (alias `local`) for offline runs, and `glm-5-3` for the runs where I want a different voice. `include_commit_signature = false` keeps the `Co-Authored-By` trailer out of my commits — my repos ask for that anyway.

## MCP servers live in the same file

Three servers are declared in `config.toml` — [wp-ops](https://github.com/imagewize/wp-ops) (stdio), an `mshin` security MCP on `localhost:3001` (bearer token read from an env var via `api_key_env_var`, never inline), and the real-browser MCP (stdio) — and every tool they expose (`[tools.wp_ops_*]`, `[tools.mshin_*]`, `[tools.real-browser_*]`, `[tools.connector_web_search_web_search]`) is set to `permission = "always"`. That is a deliberate deviation from the docs' best practice of keeping external-system tools at `ask`: all three are local processes I trust, and the WordPress ones are how I counted what an agent actually ran in [my wp-ops vs plain WP-CLI post]({% post_url 2026-11-15-claude-code-wp-cli-commands-wp-ops-vs-plain-wp %}). Anything that reaches a client server gets set back to `ask` for that project's `.vibe/config.toml`.

## What the reference says I should still clean up

Diffing my file against the configuration reference surfaced one wart: `displayed_workdir`, `context_warnings`, `include_model_info`, and `include_prompt_detail` are listed there as **deprecated** — "Vibe still accepts them in existing files, but they have no effect." They sit in my config as leftovers and each one earns a startup warning. Deleting those four lines is the next cleanup. (`applied_migrations = ["bash_read_only_defaults_v1"]` is not one of them — that is Vibe's own bookkeeping for a migration it ran on my bash tool settings.)

## Habits around the file

- Back it up (`config.toml.bak`) before editing; the file is small and entirely yours.
- The docs' best-practice list says to version-control your `.vibe/` configuration so the safety decisions are reviewable — my `~/.vibe` is not in git yet, which is the next habit to add.
- Remember the project layer: a trusted repo can ship its own `.vibe/config.toml` that overrides the user one. I removed the project-level copy from my plugin repo precisely because it was redundant with the global file.

The result after the scratchpad fix: shell commands against `~/.vibe/logs/session/unified/*/scratchpad/` run with no prompt, file tools never prompted in the first place, and the remaining prompts are the ones I actually want — anything outside the allowlisted trees, anything denylisted, and every risky call the smart-approve classifier holds back.

For the full key list see the [configuration reference](https://docs.mistral.ai/vibe/code/cli/configuration-reference); for how the permission layers interact (agents, trusted folders, per-tool permissions, the outside-workdir check) see [Safety, approvals, and permissions](https://docs.mistral.ai/vibe/code/safety-approvals-permissions).
