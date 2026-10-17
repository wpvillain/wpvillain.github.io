---
layout: post
title: "Shipping a Git-Hosted Plugin to WordPress.org SVN: A Staging Script and One Case-Sensitive Gotcha"
date: 2026-10-17 15:00:00 +0700
categories: wordpress plugins devops
tags: [wordpress, plugins, svn, wordpress-org, release, bash, distignore]
case_category: devops
case_status: shipped
---

{% raw %}
[Aludra](https://wordpress.org/plugins/aludra/), my block library plugin, lives on GitHub. Pull requests, tags and the release zip all happen there. WordPress.org only understands Subversion, though, so every release needs a second trip: copy the right files into an SVN checkout, tag them, commit. This post is how I do that now, with a small staging script, written down after shipping 2.39.0 and losing one commit to a capital letter.

## The WordPress.org SVN layout

Every plugin on WordPress.org gets a repository at `https://plugins.svn.wordpress.org/<slug>` with three top-level folders:

| Folder | What goes in it |
|---|---|
| `trunk/` | The current plugin code, exactly what ships |
| `tags/<version>/` | A frozen copy of trunk for each release |
| `assets/` | Banners, icons and screenshots for the plugin page (never part of the plugin zip) |

The plugin directory serves whatever version `Stable tag:` in `trunk/readme.txt` names, from `tags/<that version>/`. So a release means updating trunk, adding the matching tag, and committing both at once.

## Two folders, on purpose

I use two folders next to the git repo:

- **`~/code/aludra-svn-staging`** is a throwaway folder the script rebuilds from scratch every run. It has no `.svn` and no connection to anything. It holds the release as it *should* look.
- **`~/code/aludra-svn`** is the real `svn checkout`. Its `.svn/` folder knows what's already published, and `svn ci` pushes the difference live.

Keeping them apart buys a few things:

- **The script can't publish anything.** It only writes to staging. Nothing goes live until I type `svn ci` myself.
- **I can look before it lands.** If something's wrong in staging (it was, see below), I fix it and rebuild. The checkout never sees the mistake.
- **Deletions come through.** `rsync --delete` from staging into the checkout makes it match exactly, so a file removed from the plugin shows up in `svn status` as missing (`!`) and gets `svn rm`'d. Copying the plugin straight into the checkout would leave deleted files published forever.

## The script

The plugin repo already has two things this builds on:

- **`.distignore`**, the list of files that don't ship (`node_modules`, tests, `composer.json`, dev docs and so on). The GitHub release workflow already zips with it: `zip -r plugin.zip . -x@.distignore`.
- **`.wordpress-org/`**, a git-tracked folder holding the banners, icons and screenshots. It's in `.distignore`, so it never ends up inside the plugin.

The script reuses the release workflow's exact `zip -x@.distignore` filter, so trunk on WordPress.org and the GitHub zip contain the same files. It lives in `bin/`, which is also in `.distignore`, so it never ships. Aludra commits its built block assets, so there's no build step. If your plugin needs one, run it before the zip.

```bash
#!/usr/bin/env bash
#
# Prepare a WordPress.org SVN layout (trunk / tags / assets) for aludra.
# Produces a staging folder you copy into a real `svn co` checkout.
#
#   bash bin/prepare-svn.sh [STAGING_DIR]
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
ASSETS="$REPO/.wordpress-org"
STAGING="${1:-$REPO/../aludra-svn-staging}"

cd "$REPO"

# Canonical version from the plugin header (what WordPress.org reads).
VERSION="$(grep -m1 -E '^\s*\*\s*Version:' aludra.php \
  | sed -E 's/.*Version:[[:space:]]*//' | tr -d '[:space:]')"
echo "==> Plugin version: $VERSION"

# The three version places must agree.
STABLE_TAG="$(grep -m1 -E '^Stable tag:' readme.txt | sed -E 's/Stable tag:[[:space:]]*//' | tr -d '[:space:]')"
CONSTANT="$(grep -m1 "define( 'ALUDRA_VERSION'" aludra.php | sed -E "s/.*'ALUDRA_VERSION', '([^']+)'.*/\1/")"
if [ "$STABLE_TAG" != "$VERSION" ] || [ "$CONSTANT" != "$VERSION" ]; then
  echo "!! Version mismatch: header $VERSION, readme Stable tag $STABLE_TAG, ALUDRA_VERSION $CONSTANT" >&2
  exit 1
fi
grep -q "^## \[$VERSION\]" CHANGELOG.md \
  || echo "!! Warning: no '## [$VERSION]' section in CHANGELOG.md" >&2

# The payload is zipped from the working copy, so make sure it is the release.
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "!! Warning: uncommitted changes to tracked files will end up in trunk/" >&2
fi
if [ "$(git rev-parse HEAD)" != "$(git rev-parse -q --verify "v$VERSION^{commit}" || true)" ]; then
  echo "!! Warning: HEAD is not tag v$VERSION" >&2
fi

# Clean staging.
rm -rf "$STAGING"
mkdir -p "$STAGING/trunk" "$STAGING/tags" "$STAGING/assets"
STAGING="$(cd "$STAGING" && pwd)"
SVN_DIR="$(dirname "$STAGING")/aludra-svn"

# Build the payload the SAME way the release workflow does, then expand into trunk/.
echo "==> Assembling trunk/ via .distignore filter ..."
TMPDIR="$(mktemp -d)"
zip -r -q "$TMPDIR/payload.zip" . -x@.distignore
unzip -q "$TMPDIR/payload.zip" -d "$STAGING/trunk"
rm -rf "$TMPDIR"

# Frozen release tag = exact copy of trunk.
echo "==> Copying trunk/ -> tags/$VERSION/ ..."
cp -R "$STAGING/trunk" "$STAGING/tags/$VERSION"

# Marketing assets live in the top-level assets/, NOT in trunk.
echo "==> Copying marketing assets from .wordpress-org/ ..."
cp "$ASSETS"/*.png "$STAGING/assets/"
[ -f "$ASSETS/icon.svg" ] && cp "$ASSETS/icon.svg" "$STAGING/assets/"

echo
echo "==> Layout ready at: $STAGING"
( cd "$STAGING" && find . -maxdepth 2 -mindepth 1 | sort )
echo
cat <<EOF
=== Next steps ===

  svn co https://plugins.svn.wordpress.org/aludra "$SVN_DIR"   # or: svn up "$SVN_DIR"

  rsync -a --delete --exclude=.svn "$STAGING/trunk/"  "$SVN_DIR/trunk/"
  rsync -a --delete --exclude=.svn "$STAGING/assets/" "$SVN_DIR/assets/"
  cp -R "$STAGING/tags/$VERSION" "$SVN_DIR/tags/"

  cd "$SVN_DIR"
  svn add --force trunk tags assets
  svn status | awk '/^!/ {print \$2}' | xargs svn rm   # files removed since last release
  svn propset svn:mime-type image/png assets/*.png
  svn propset svn:mime-type image/svg+xml assets/icon.svg
  svn status                     # sanity-check what will be committed
  svn ci -m "Release $VERSION" --username YOUR_WP_ORG_USERNAME
EOF
```

A few choices in there are deliberate:

- **The version check fails hard.** WordPress.org reads the plugin header, `readme.txt` holds `Stable tag`, and the plugin has a version constant. If they disagree, the release is wrong, so the script stops before staging anything.
- **The git checks only warn.** Uncommitted changes or HEAD not sitting on the release tag usually mean you're about to ship something other than what you tagged. There are harmless exceptions, though (I hit one, see below), so they're warnings, not errors.
- **It prints the SVN steps instead of running them.** Commits to WordPress.org are public and go out to every site running the plugin. I want that last step typed by hand.
- **Full paths in the printed steps.** The first version printed `aludra-svn/trunk/`, which only works from one particular folder. Absolute paths work from anywhere.
- **The MIME types on assets.** Without `svn:mime-type`, PNGs can download instead of displaying on the plugin page. The `propset` on the SVG prints a warning that it "looks like text". That's fine.

I adapted it from the same script in another of my plugins. Making it a reusable tool in a shared ops repo has come and gone before. The general version kept going stale while the per-plugin copies were the ones actually used.

## The release, step by step

With the version bumped and tagged in git:

```bash
bash bin/prepare-svn.sh
```

The first time, check out the SVN repo. It works from any folder because the destination is a full path:

```bash
svn co https://plugins.svn.wordpress.org/aludra ~/code/aludra-svn
```

(Plain `svn co` with no arguments just answers `E205001: Not enough arguments provided`.) After the first release, `svn up ~/code/aludra-svn` instead.

**Before copying the tag, check it doesn't already exist.** If `tags/2.39.0/` is already there, `cp -R` nests a second `2.39.0` inside it rather than replacing it. You shouldn't be rewriting a published tag anyway. WordPress.org even added a pre-commit rule against [nested tags](https://make.wordpress.org/systems/2025/04/30/plugins-pre-commit-rule-to-prevent-nested-tags/), because people kept copying the whole repo into a tag folder.

Then run the printed steps up to `svn status`, and read that output. For 2.39.0 it was 6 modified files and the new blocks' files in trunk, a full copy in `tags/2.39.0/`, and nothing in `assets/` (the images hadn't changed). Two quick checks I run before committing:

```bash
diff -rq --exclude=.svn trunk tags/2.39.0 && echo "trunk == tag"
svn diff trunk/readme.txt | head -40      # Stable tag bumped, changelog entry present
```

## What reading `svn status` caught

The status listed two files that weren't in the previous release: `blocks/faq-tabs/README.md` and `blocks/mega-menu/README.md`. Harmless, but unintended. The cause is a difference between the two tools `.distignore` gets fed to:

- **`zip -x@.distignore`** matches whole paths, so `README.md` only excludes the root README.
- **`rsync --exclude-from=.distignore`** treats a pattern with no slash as a basename at *any* depth, so `README.md` excluded every README.

The previous release was most likely staged through rsync, and this one went through zip. The fix is a pattern with a slash, which means the same thing to both tools:

```
blocks/*/README.md
```

Then rebuild staging, revert the four already-scheduled README additions (`svn revert` plus `rm`, since they were added but never committed), rsync again, and confirm trunk and the tag still match. The script's "uncommitted changes" warning fired on the rebuild, because of the `.distignore` edit. `.distignore` never ships, so the warning was safe to ignore. That's why it's a warning and not an error.

If your `.distignore` serves both tools, keep root-only entries anchored with a leading slash (`/package.json`) and nested ones explicit (`blocks/*/README.md`).

## The commit, and the capital letter

```bash
cd ~/code/aludra-svn && svn ci -m "Release 2.39.0" --username yourname
```

The first time, the whole upload went through, every file, and then:

```
svn: E165001: Commit blocked by pre-commit hook (exit code 1) with output:
Access denied: user 'yourname' cannot modify:
  /aludra/tags/2.39.0
  /aludra/tags/2.39.0/CHANGELOG.md
  ...
  ... and 756 more paths
```

Because the list starts with `tags/`, it looks like a rule about tags. It isn't. 20 listed plus "756 more" was exactly the number of changed paths in `svn status`, trunk included: the server had refused the *entire* commit. `svn log` on the repo showed the previous release had been committed by the same account name **with a capital first letter**. WordPress.org SVN usernames are case-sensitive, and the lowercase spelling was effectively a stranger with no access to the plugin.

The retry with the correctly cased username went through:

```
Committing transaction...
Committed revision 3751591.
```

Nothing had been published by the failed attempt, because SVN commits are atomic. Either every path lands or none does, so a refused commit leaves the server untouched and you just run it again.

Two more things about credentials:

- **The password is not your WordPress.org login password.** It's a separate SVN password, set under *Account & Security* on your WordPress.org profile.
- **Check `svn log -l 3 -q https://plugins.svn.wordpress.org/<slug>`** if a commit is refused. It shows the exact username past releases were committed with.

## Verify it's live

```bash
svn ls https://plugins.svn.wordpress.org/aludra/tags
svn cat https://plugins.svn.wordpress.org/aludra/trunk/readme.txt | grep "Stable tag"
curl -s "https://api.wordpress.org/plugins/info/1.2/?action=plugin_information&request%5Bslug%5D=aludra" \
  | grep -o '"version":"[^"]*"'
```

The API reported the new version within a minute or two, which is what sites check for updates. The download zip on the plugin page took a bit longer to rebuild.

## The short version

```bash
# in the plugin repo, after bumping and tagging the version
bash bin/prepare-svn.sh
svn up ~/code/aludra-svn                 # or svn co the first time
# run the printed rsync / cp / svn add / svn rm / propset steps
svn status                               # read it
svn ci -m "Release X.Y.Z" --username YourExactCaseName
```

Stage outside the checkout, let `rsync --delete` and `svn rm` handle deletions, read `svn status` before committing, and spell your username the way WordPress.org does.
{% endraw %}
