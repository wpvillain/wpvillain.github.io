---
layout: post
title: "Test an Unreleased Plugin in a Bedrock Site With a Composer Path Repository (and Why symlink Must Be false)"
date: 2026-10-30 09:00:00 +0700
categories: wordpress bedrock composer
tags: [wordpress, bedrock, composer, plugin-development, path-repository, roots, devops]
case_category: devops
case_status: documented
---

You have a plugin or theme in its own repository and a Bedrock site that installs it with Composer. Before you tag a release you want to see the branch running in the real site. Pushing a throwaway tag to Packagist, or to a private package registry, is the slow way. A Composer `path` repository points the site at your local checkout instead.

This is a local-only change to the site's `composer.json`. Do not commit it.

## The short version

In the Bedrock site's `composer.json`, add a `path` repository and change the constraint to the branch:

```json
"repositories": [
  {
    "type": "path",
    "url": "../../my-plugin",
    "options": { "symlink": false }
  },
  {
    "name": "wp-packages",
    "type": "composer",
    "url": "https://repo.wp-packages.org"
  }
],
"require": {
  "vendor/my-plugin": "dev-feature-xyz"
}
```

```bash
cd /path/to/bedrock-site
composer update vendor/my-plugin
```

You should see `Mirroring from ../../my-plugin`, and the plugin appears as a normal directory in `web/app/plugins/`.

## The details that matter

**Put the path repository first.** Composer evaluates repositories in order, so listing it first lets it win over Packagist or a private registry for that package.

**`url` is relative to the site's `composer.json`.** Absolute paths work, relative ones are easier to move between machines.

**The constraint is `dev-<branch>`.** A path repository takes its version from the branch checked out in the local repo. Branch `feature-xyz` becomes `dev-feature-xyz`, and slashes stay, so `feat/xyz` becomes `dev-feat/xyz`. Bedrock ships with `"minimum-stability": "dev"` and `"prefer-stable": true`, so a `dev-` constraint resolves.

**If another package requires yours with a semver range** such as `^2.0`, add an inline alias so both resolve:

```json
"vendor/my-plugin": "dev-feature-xyz as 2.0.99"
```

## Why `symlink` must be false

Composer's default for a path repository is to symlink the package into place. For a Bedrock plugin that ends with WordPress deactivating it:

> The plugin `my-plugin/my-plugin.php` has been deactivated due to an error: Plugin file does not exist.

WordPress resolves the plugin file with `realpath()`, which follows the symlink to a location outside `web/app/plugins/`, such as `/Users/you/code/my-plugin`. The plugin slug WordPress derives from that path no longer matches the stored activation record, so it decides the file is missing. Themes hit the same problem.

`"symlink": false` makes Composer copy ("mirror") the package, so WordPress sees a real directory inside the install. The price is the next section.

## Re-sync after every edit

A copy does not follow your edits. Composer also skips re-mirroring when the commit hash has not changed, so delete the installed directory first:

```bash
cd /path/to/bedrock-site
rm -rf web/app/plugins/my-plugin && composer update vendor/my-plugin
```

The mirror reflects the working tree at that moment, so save your changes in the package repo before you run it.

## Alternative: a vcs repository

If you have pushed the branch and want a teammate to be able to reproduce the setup, use a `vcs` repository:

```json
"repositories": [
  { "type": "vcs", "url": "https://github.com/vendor/my-plugin" }
]
```

Keep the `dev-feature-xyz` constraint. You get a normal git checkout, with no symlink problem, but every edit needs a push and a `composer update`.

## Clean up

When the release is tagged:

1. Remove the `path` or `vcs` entry from `composer.json`.
2. Put the normal constraint back (for example `^2.0`).
3. Run `composer update vendor/my-plugin`.

## Gotchas

- **Never commit the path.** The `url` only exists on your machine. Keep the change on a local branch, or stash it.
- **Built assets.** If the package ships a build artifact such as a bundle in `dist/`, build it before mirroring. The site loads the built file, not your `src/`.
- **Stale mirror.** If the site seems to ignore a change, you forgot the `rm -rf`.

If the Bedrock site also deploys with Trellis, the package has to be a real release again before you deploy. [The Sage package post]({% post_url 2026-08-24-sage-theme-composer-package-trellis-deploy %}) covers that side.
