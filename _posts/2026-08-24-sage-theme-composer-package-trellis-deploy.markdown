---
layout: post
title: "Splitting a Sage Theme From Its Trellis Deploy: Nynaeve as a Composer Package"
date: 2026-08-24 18:00:00 +0700
categories: wordpress trellis composer sage bedrock
tags: [wordpress, trellis, composer, sage, bedrock, deployment, ansible, roots, acorn]
case_category: devops
case_status: shipped
---

Our Sage 11 theme, Nynaeve, used to live two places at once: as its own standalone repo, and as a plain git-tracked copy pasted into the main site repo's `web/app/themes/nynaeve`. A manual `rsync-theme.sh` script kept the copy in sync. That's exactly the kind of setup that looks fine until the two copies quietly disagree — which is what happened. The theme repo's docs described block *categories* (`nynaeve/hero`, `nynaeve/cta`, …) and block *namespaces* (`imagewize/hero`, `imagewize/cta`, …) correctly, but the copy that shipped to the site repo drifted, and content across the site ended up with broken `wp:nynaeve/*` markup where it should have been `wp:imagewize/*`. Found and fixed the same day we started this change.

That was the last straw. This post covers [PR #397](https://github.com/imagewize/imagewize.com/pull/397): moving Nynaeve from a git-tracked directory to a real Composer dependency — the same pattern the project already used for `imagewize/min` and `imagewize/callandor` — and the deploy-hook rework that made it work with Trellis.

## The Old Setup

- `web/app/themes/nynaeve` was committed straight into the site repo: 411 files, full history, PHP source, compiled assets, fonts, icons — everything.
- The theme's *actual* source of truth was a separate repo, `~/code/nynaeve`.
- `rsync-theme.sh` pushed changes from the site repo copy back to the standalone repo (or the reverse, depending on which way you'd last edited). Either direction relied on a human running it at the right time.
- Two copies, one intended source of truth, no enforcement. The block-namespace drift was the first visible symptom; it wouldn't have been the last.

## What Changed

`site/composer.json` now requires the theme directly:

```json
"require": {
    "imagewize/nynaeve": "^3.1.0"
}
```

Nynaeve's own `composer.json` already declares `"type": "wordpress-theme"`, so Bedrock's existing `installer-paths` mapping drops it into `web/app/themes/nynaeve/` automatically — no extra config needed on the consuming side. `site/.gitignore` gets `web/app/themes/nynaeve` added, matching the other Composer-managed themes already in the project (`twentytwentyfive`, `ianua`). The 411 tracked files come out of git in the same commit.

That's the easy part. The part that took real thought was the deploy hooks.

## Why the Deploy Hook Had to Split in Two

Trellis builds a release in stages, and two of our theme-build steps depend on the theme's *PHP source* being present on the **remote** release path — not just locally:

1. The theme's own `composer install` (its acorn / illuminate / acf-composer dependencies — Sage themes carry their own theme-scoped `vendor/`, separate from the project root's).
2. Copying the compiled `public/build` assets up to the release.

Before this change, Nynaeve's source was git-tracked, so `git archive` — which is what actually populates a Trellis release directory — brought the theme's PHP along for free. Once Nynaeve stopped being git-tracked, `git archive` had nothing to bring. The theme only exists on the release path *after* something runs `composer install` against the release's `composer.json`.

That something is Trellis's own core hook. `deploy_build_after` (`roles/deploy/defaults/main.yml`) runs the core `roles/deploy/hooks/build-after.yml` — which does the root-level `composer install` that fetches `imagewize/nynaeve` onto the release — **before** it runs our site's own `build-after.yml` override. That ordering is the whole trick: our custom build-after hook can safely assume the theme source already exists on the release path, because Trellis's own hook just put it there.

Which means the theme's own `composer install` and the asset copy can't live in `build-before.yml` — at build-before time, on a fresh deploy, the theme hasn't been fetched onto the release yet. They have to move to `build-after.yml`, downstream of the core hook.

### build-before.yml — local concerns only

```yaml
- name: Install root Composer dependencies (pulls nynaeve theme package)
  command: composer install
  delegate_to: localhost
  args:
    chdir: "{{ project_local_path }}"
  when: site == 'imagewize.com'

- name: Install npm dependencies
  command: npm install
  delegate_to: localhost
  args:
    chdir: "{{ project_local_path }}/web/app/themes/nynaeve"
  when: site == 'imagewize.com'

- name: Compile assets
  command: npm run build
  delegate_to: localhost
  args:
    chdir: "{{ project_local_path }}/web/app/themes/nynaeve"
  when: site == 'imagewize.com'
```

Everything here runs on the machine doing the deploy, not the remote release. The local `composer install` pulls `imagewize/nynaeve` down locally too (so `npm install`/`npm run build` have theme source to compile against), and a `stat` + `fail` guard right after confirms `public/build/manifest.json` exists before the deploy is allowed to continue — no silently shipping a release with no compiled assets.

### build-after.yml — the two steps that need the remote release

```yaml
- name: Install theme's own Composer dependencies
  command: composer install --no-ansi --no-dev --no-interaction --no-progress --optimize-autoloader --no-scripts --classmap-authoritative
  args:
    chdir: "{{ deploy_helper.new_release_path }}/web/app/themes/nynaeve"
  when: site == 'imagewize.com'

- name: Copy compiled assets
  synchronize:
    src: "{{ project_local_path }}/web/app/themes/nynaeve/public"
    dest: "{{ deploy_helper.new_release_path }}/web/app/themes/nynaeve"
    group: no
    owner: no
    rsync_opts: --chmod=Du=rwx,--chmod=Dg=rx,--chmod=Do=rx,--chmod=Fu=rw,--chmod=Fg=r,--chmod=Fo=r
  when: site == 'imagewize.com'
```

The compiled assets themselves are still built locally in build-before (rebuilding on the server would mean shipping npm/node as a production dependency, which we don't want), then rsynced up from the local `public/build` directory onto the just-fetched theme on the release path. Both steps stay gated `when: site == 'imagewize.com'` — block themes like Elayne on `demo.imagewize.com` skip this whole file, same as before.

## Switching to Packagist

The PR started with a `vcs` repository entry pointing straight at `git@github.com:imagewize/nynaeve.git` on a `dev-main` pin, purely to prove the mechanism worked end to end. Once that was confirmed, `imagewize/nynaeve` got published to Packagist — same as Elayne, Aviendha, and Aludra — and the `vcs` entry came out, replaced with a version constraint:

```json
"imagewize/nynaeve": "^3.1.0"
```

`composer.lock` now records a genuine dist install: a GitHub zipball pulled through Packagist, not a live git clone. No `.git/` directory shows up in the installed copy, which is the tell that confirms it. On-disk `style.css` reports `Version: 3.1.0`, matching the lockfile.

## One Idea That Didn't Survive Contact With Lima

Before settling on the Composer-dependency approach, there was a tempting shortcut: add a `path` repository (`../../nynaeve`, `symlink: true`) ahead of the Packagist one, so Composer would symlink straight to `~/code/nynaeve` locally instead of downloading a dist copy. That would kill the rsync loop entirely and give live HMR against uncommitted theme edits — no publish step needed just to see a change.

It works fine on the raw macOS filesystem. It does not work inside the Lima VM that actually serves `imagewize.test`. Lima only mounts specific subdirectories of `~/code/imagewize.com` — confirmed with `limactl show-ssh imagewize.com` — and `~/code/nynaeve` isn't one of them. From inside the VM, the symlink points at nothing. Reverted that part. A Lima mount for `~/code/nynaeve` is a plausible follow-up if the sync-script loop below turns out to be annoying in daily use, but it wasn't worth blocking this PR on.

## Local Dev Workflow Now

Editing happens in `~/code/nynaeve`, same as before. Testing a change locally without cutting a full release uses `wp-ops`'s sync script, matching the pattern already in use for Elayne, Aviendha, and Aludra:

```bash
SITE_ROOT=~/code/imagewize.com/site/web/app \
  wp-ops/scripts/sync/rsync-package-to-site.sh theme nynaeve ~/code/nynaeve
```

To publish for real: tag and push the theme repo, then pull it into the site with `composer update imagewize/nynaeve`. The old `rsync-theme.sh` — the one that synced imagewize.com's copy *back* to the mirror — is obsolete and gone.

## A Tradeoff We're Leaving As-Is

Nynaeve's own `composer.json` `require` (acorn, `illuminate/*`, acf-composer, etc.) now also gets resolved into the site's **root** `vendor/` when Composer solves the whole project, on top of the theme's own theme-scoped `vendor/` that `functions.php` actually loads via `__DIR__.'/vendor/autoload.php'`. The root copy is never used — it's dead weight from Composer's dependency solver, not a functional problem. This is a pre-existing property of the Sage/Acorn "theme carries its own vendor" convention, not something this change introduced, and not worth fighting.

## Verifying It

Before the Packagist switch, we ran the full local equivalent of the new build-before → build-after sequence by hand against the Trellis VM:

```bash
composer update imagewize/nynaeve --with-dependencies   # in site/ — pulled from GitHub, dev-main
npm install && npm run build                              # in the theme dir — built clean
composer install ...                                       # in the theme dir — own vendor/autoload.php
wp cache flush && wp theme status nynaeve                  # → Status: Active, Version: 3.1.0
curl http://imagewize.test/                                 # → 200, correct <title>
```

After switching to Packagist, the re-check was static rather than a full VM run — same installed theme, just a different resolution path: `composer validate` passes, `composer.lock`/`installed.json` agree on `v3.1.0` resolved via Packagist's GitHub zipball dist, no `.git/` present (confirming dist, not VCS), and `style.css` still reports `3.1.0`.

An actual `trellis deploy` to production was intentionally left for after merge — the plan was to review the build-before/build-after split first, then deploy and watch the theme's Composer-install step and the asset-copy step specifically, since those are the two that moved.

## Takeaway

The mechanism worth remembering here isn't Composer-specific — it's the **hook ordering**. Trellis's core `build-after.yml` hook runs before a site's own override of the same file, and that ordering is what makes it possible to fetch a package onto the release *and* immediately depend on it being there in the very next hook, without any extra "wait for it" logic. Once that ordering clicked, the fix was mechanical: move the two steps that need the theme's PHP present on the remote release from build-before to build-after, and let Trellis's own hook do the fetching in between.

The bigger win is structural, not mechanical: one source of truth for the theme, published like any other dependency, with drift no longer possible by construction instead of caught after the fact — the way the block-namespace bug was.

This is part of the Trellis/Bedrock/Sage deployment stack we run at [Imagewize](https://imagewize.com) for client projects. If you're maintaining a Sage or Acorn theme alongside a Trellis deploy and want a second set of eyes on the setup, [get in touch](https://imagewize.com/contact-us/).

---

*Running a similar Composer-managed theme setup and hit a snag? Find me on Mastodon at [@jfrumau@mastodon.social](https://mastodon.social/@jfrumau).*
