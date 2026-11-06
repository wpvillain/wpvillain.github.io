---
layout: post
title: "Which Mistral Model for Which Block Theme Task: My Routing Table for Elayne, and Why It Can't Live in AGENTS.md"
date: 2026-11-06 10:00:00 +0700
categories: vibe ai block-themes
tags: [vibe, mistral, ai, block-themes, block-patterns, gutenberg, elayne, ai-agents]
case_category: ai
case_status: documented
---

I run four models in Mistral Vibe while working on the Elayne block theme: Mistral Large, GLM 5.3, GLM 5.3 Flash and Mistral Medium 3.5. Asking all of them to do everything is slow and costly, so I asked Vibe for a split by task. This post is that split, the reasoning behind it, and the part I got wrong at first: where such a split can live.

**Who made these recommendations:** the split, the routing table and the advice on where it can live were produced by Mistral itself, in a Vibe session running Mistral Large 4 (`mistral-large-4-0-3`). I gave it my `~/.vibe/config.toml` and described the kind of work the Elayne repo involves, then checked its claims about Vibe's config options before agreeing. The conclusions are its analysis, reviewed by me.

**What is and is not tested:** the table below is a working hypothesis built from the failure modes I keep hitting in block pattern work. I have not benchmarked the models against each other. Treat the assignments as a starting point and adjust them against your own failures.

## The deciding question: what does a mistake cost?

Block theme work has one expensive failure mode. A pattern can look fine in the file, pass `php -l`, and still fail in the browser, because Gutenberg's serializer rewrites the markup and finds a mismatch. You only see that in the editor ("this block contains unexpected content") or in a validation run. A model that gets it wrong costs you a full validate, rebuild and browser loop.

So the split follows one rule: **the more a task depends on satisfying the serializer or the design system on the first try, the bigger the model.**

| Task | Model | Why |
|---|---|---|
| New pattern from scratch | Mistral Large | Dense, non-obvious rules: block-comment JSON shape, font sizes as classes not inline styles, layout and gap rules, spacing presets |
| Debugging validation failures (serializer mismatches, brace-count diffs) | Mistral Large or GLM 5.3 | Needs root-cause tracing, not pattern matching |
| `theme.json` and style variation decisions | Mistral Large | A new token or palette change affects every pattern downstream |
| WooCommerce templates, child themes, new vertical pattern sets | Mistral Large | Cross-file and hard to verify mechanically |
| Targeted edit to an existing, valid pattern | GLM 5.3 | The conventions are already in the file and the change is local |
| Bulk sweeps: i18n wrapping, slug renames, URL swaps | GLM 5.3 Flash | High volume, low ambiguity |
| Running the validation, rebuild and Playwright loop and summarizing | GLM 5.3 Flash or Medium 3.5 | Mostly command orchestration |
| Template parts, small PHP helpers, phpcs fixes | Medium 3.5 | Small, and `php -l` or phpcs tells you immediately if it is wrong |
| Changelog, readme, commit messages, PR text | GLM 5.3 Flash | Prose, low risk (use Large for WordPress.org-facing description copy) |

Three rules fall out of it:

1. **Large for anything that must pass the serializer first try.** Do not gamble there.
2. **GLM 5.3 is the workhorse for edits to patterns that already validate.**
3. **If a cheaper model fails validation twice, escalate to Large instead of retrying.** A third attempt rarely fixes a misunderstanding of the rules.

For the rules those first-try tasks have to satisfy, see [the layout rules post]({% post_url 2026-10-28-wordpress-block-pattern-layout-alignfull-grid-spacing-rules %}), [the PHP files post]({% post_url 2026-10-28-wordpress-block-pattern-php-files-headers-escaping-images %}) and [the pattern validation post]({% post_url 2026-10-30-bedrock-wp-cli-yml-and-pattern-validate-block-pattern-files %}).

## Where I wanted to put it, and why that was wrong

My first instinct was to paste the table into the repo's `AGENTS.md` so the model "knows" which model to use. That fails for three reasons.

**1. A model cannot switch itself.** `AGENTS.md` is read by the model that is already running. It cannot change its own model mid-session. Only you can, with `/model <alias>`, so the table only helps if you read it.

**2. The file is public and shared.** The Elayne repository is public, and its `AGENTS.md` is read by every tool and contributor. My private model aliases and session habits do not belong there, and every extra line costs context for everyone.

**3. A project `config.toml` cannot express it.** In my setup the config pins a default model (`active_model`), not a model per task. The global default was already Large, so a project config would only repeat it. I had removed the project config for that reason, and that was the right call.

## What can actually route

| Mechanism | What it does |
|---|---|
| `/model <alias>` | You switch by hand for the session. Free, and it keeps you in control. |
| A subagent with a pinned model | The only hard routing. A pattern-author agent on Large and a validation-loop agent on Flash, each with its own `active_model`. |
| One-shot with `--model` | Run a cheap model on a batch job without touching any file. |

My existing Vibe agents (frontend builder, maintainer, reviewer and others) pin no model, so they all inherit whatever the session uses. If I want routing that does not depend on me remembering, a pinned-model subagent is the way, and it belongs with my other agents, not in the theme repository.

## What I am actually doing

Nothing structural. The setup works because the default is already Large. My practice is two tiers in my head: Large whenever I touch `patterns/` or `theme.json`, a cheaper model for validation loops, sweeps and docs, and Large again after two failed validations. If that stops being enough, the next step is one or two pinned subagents, not a longer instruction file.

The general lesson goes beyond Mistral: an instruction file tells a model how to work, not which model should be working. If you want the second, configure it where the tool picks the model.
