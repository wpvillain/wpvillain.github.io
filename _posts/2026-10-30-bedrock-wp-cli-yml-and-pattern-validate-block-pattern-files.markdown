---
layout: post
title: "A Standard wp-cli.yml for Bedrock, and a WP-CLI Command That Validates Block Pattern Files Against Gutenberg's Own Output"
date: 2026-10-30 10:30:00 +0700
categories: wordpress bedrock wp-cli
tags: [wordpress, bedrock, wp-cli, block-patterns, gutenberg, block-themes, ci]
case_category: devops
case_status: documented
---

Two small pieces that I put in every Bedrock site root. The first is a `wp-cli.yml` that ends the `--path=web/wp` typing. The second is a WP-CLI command that checks block pattern files against the markup WordPress itself would write.

## wp-cli.yml

In Bedrock, WordPress core lives in `web/wp`, not in the project root, so WP-CLI cannot find it unless you say so on every call. Put this next to `composer.json`:

```yaml
path: web/wp
server:
  docroot: web
require:
  - wp-cli-pattern-validate.php
```

| Key | What it does |
|---|---|
| `path` | Tells WP-CLI where core lives, so `--path=web/wp` is never needed |
| `server.docroot` | `wp server` (the built-in dev server) serves Bedrock's `web` directory |
| `require` | Loads the pattern command on every `wp` call, with no `--require` flag |

If you drop the `require` line, nothing else changes: the pattern command is the only thing it loads.

## Why validate patterns at all

Block pattern files are hand-written HTML with block comments. Gutenberg, on the other hand, reserialises block markup when it saves, and it does so in a specific way: attribute order, spacing, escaped characters. If your pattern file differs from that canonical form, the editor can show "this block contains unexpected content" or rewrite it the first time someone opens it. Rules about patterns themselves are in [the layout rules post]({% post_url 2026-10-28-wordpress-block-pattern-layout-alignfull-grid-spacing-rules %}) and [the PHP files post]({% post_url 2026-10-28-wordpress-block-pattern-php-files-headers-escaping-images %}); this is the mechanical check.

## The command

`wp imagewize pattern-validate` reads each pattern file, takes the block HTML (either the `return '...'` form or the docblock plus raw HTML form), runs it through WordPress's own `parse_blocks()` and `serialize_blocks()`, and compares the result to the original. It reverses the unicode escapes that serialisation adds for `<`, `>`, `&` and `--`, so PHP tags, `--wp--` CSS variables and literal ampersands survive unchanged.

```bash
# Dry run: PASS or FAIL per file
wp imagewize pattern-validate web/app/themes/your-theme/patterns/

# Show a diff for each file that needs changes, write nothing
wp imagewize pattern-validate web/app/themes/your-theme/patterns/ --diff

# Rewrite non-canonical files in place
wp imagewize pattern-validate web/app/themes/your-theme/patterns/ --fix

# Fix and keep per-file diffs plus a summary in docs/pattern-logs/<date>/
wp imagewize pattern-validate web/app/themes/your-theme/patterns/ --fix --log

# One file, or one subdirectory
wp imagewize pattern-validate web/app/themes/your-theme/patterns/hero.php --fix
wp imagewize pattern-validate web/app/themes/your-theme/patterns/woocommerce/ --fix
```

Files under a `woocommerce/patterns/` path are skipped, because they follow WooCommerce's own standards.

| Flag | Meaning |
|---|---|
| `--fix` | Rewrite each non-canonical file |
| `--diff` | Print a unified diff, no writes |
| `--log`, `--log-dir=<path>` | Write `.diff` logs and a `summary.md` (default `docs/pattern-logs/<date>/`) |
| `--compliance` | Run your project's own checks after the structural pass |
| `--compliance-only` | Skip the round trip, run only those checks |

Exit code `0` means every file passes or was fixed. `1` means a file needs changes in a dry run, or a write failed. That makes it usable as a pre-commit hook or a CI step: run it without `--fix` and let the exit code fail the job.

The compliance flags call a stub, `run_compliance_checks()`. Point it at your own static-analysis script if you have one. Left alone, it prints a warning and exits cleanly.

## Get it into a site

The command lives in the wp-ops repository as `wp-cli/content-creation/wp-cli-pattern-validate.php`. Copy it to the Bedrock site root next to `wp-cli.yml`, or run it from the checkout without copying anything:

```bash
WP_SITE_DIR=/path/to/site wp-ops bedrock wp-cli-pattern-validate web/app/themes/your-theme/patterns/ --fix
```

If the file is not auto-loaded by `wp-cli.yml`, pass it explicitly:

```bash
wp --require=wp-cli-pattern-validate.php imagewize pattern-validate web/app/themes/your-theme/patterns/
```

## Requirements

WP-CLI 2.x, PHP 7.4 or newer, and the `diff` binary (standard on macOS and Linux). Run `wp` from the site root: WordPress has to be bootstrapped for `parse_blocks()` and `serialize_blocks()` to exist.
