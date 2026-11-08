---
layout: post
title: "Update Trellis With a Three-Way Merge, Not rsync Excludes: Keep Every Local Change Without Maintaining a List"
date: 2026-11-08 10:00:00 +0700
categories: wordpress trellis ansible
tags: [wordpress, trellis, ansible, git, devops, upgrade, merge]
case_category: devops
case_status: shipped
---

Two weeks ago I wrote up [how I update Trellis with a backup, a diff and rsync with excludes](/update-trellis-without-losing-customisations-rsync-excludes/). Today I updated a production Trellis from 1.28 to 1.33 and did not use that routine, because when I checked what it would do, it would have broken things.

The problem with rsync excludes is that the exclude list is the only thing protecting your changes, and the list is never complete. On this project, three files with real local changes were not on it:

- the fail2ban filters, where I anchored the `wp-login.php` and `xmlrpc.php` regexes to the request field
- `roles/wordpress-setup/tasks/main.yml`, which sets up a separate PHP-FPM pool for a demo multisite
- `roles/mariadb/templates/50-server.cnf.j2`, with MariaDB tuning

rsync would have overwritten all three without a word. The diff step would have shown them afterwards, mixed in with fifty legitimate upstream changes. That is exactly where things get missed.

## Copy only what upstream changed

The fix is to stop copying upstream files at all. Instead, take only what upstream changed between the release you are on and the release you want, and merge that into your files. That is a three-way merge per file:

| Version | What it is |
|---|---|
| base | the file at the release you are on, e.g. `v1.28.0` |
| theirs | the file at the target release, e.g. `v1.33.0` |
| ours | your file in `trellis/` |

Git does this for single files with `git merge-file`, no repository needed:

```bash
git clone https://github.com/roots/trellis.git /tmp/trellis-upstream
cd /tmp/trellis-upstream

git show v1.28.0:roles/php/defaults/main.yml > /tmp/base
git show v1.33.0:roles/php/defaults/main.yml > /tmp/theirs

git merge-file -p -L local -L v1.28.0 -L v1.33.0 \
  ~/code/website.com/trellis/roles/php/defaults/main.yml /tmp/base /tmp/theirs
```

What this gets you, which no exclude list can:

- **Your edits survive by default.** A file only changes where upstream changed it.
- **Cherry-picked fixes merge cleanly.** I had already copied six upstream fixes into this tree by hand (PRs #1625, #1638, #1640, #1642, #1653 and #1697). The same change on both sides is not a conflict.
- **Real overlaps are visible.** When your line and upstream's line touch, you get standard `<<<<<<<` markers in the file, which `git diff` shows and a YAML parser refuses. You cannot provision past it by accident.
- **Files upstream deletes** can be removed only when you never changed them.

Loop that over `git diff --name-status --no-renames v1.28.0 v1.33.0` and you have the whole update.

## First: which release are you actually on?

The merge needs the right base, and this is where I got a surprise. The project's `trellis/CHANGELOG.md` ended at 1.27.0. Upstream removed its changelog in a later release, so the file had simply stopped being updated. The tree itself was newer.

Trellis 1.29 and later ship a `VERSION` file, which settles it. For older trees, count how many upstream files differ from yours at each tag and pick the lowest:

```text
  v1.33.0: 46 file(s) differ
  v1.32.2: 46 file(s) differ
  v1.31.0: 38 file(s) differ
  v1.30.0: 34 file(s) differ
  v1.29.0: 33 file(s) differ
  v1.28.0: 27 file(s) differ
  v1.27.0: 51 file(s) differ
```

The tree was 1.28.0, from a February update, plus the six cherry-picks. Merging from 1.27 would have replayed changes that were already there.

## What happened when I used `patch` first

My first attempt today was the obvious shortcut: `git diff v1.28.0 v1.33.0` as a patch, applied with `patch -p1 --forward`. It mostly worked, and the ways it did not are the argument for a real merge:

- `--forward` decides per file. If it sees one hunk that is already applied, it reports `Ignoring previously applied (or reversed) patch` and skips **the whole file**, including any hunks that were new. Three files went that way. I had to check each `.rej` by hand to confirm nothing new was lost.
- `roles/php/defaults/main.yml` failed outright: a cherry-picked line sat next to an upstream change, so neither hunk matched.
- Deleted upstream files were left behind as empty files. The removed `ssmtp` role stayed as four zero-byte files until I ran `git rm`.

## Replaying the update with the merge

I put the merge into `wp-ops trellis-updater` ([wp-ops](https://github.com/imagewize/wp-ops) 5.44.0) and replayed the same update. I used a git worktree checked out at the commit before today's upgrade:

```bash
git worktree add --detach /tmp/replay <commit-before-upgrade>
cd /tmp/replay/trellis
TRELLIS_DIR=$PWD wp-ops trellis-updater --dry-run
```

```text
Updating: v1.28.0 -> v1.33.0
Merged cleanly (23)
Added (4)
Deleted (unchanged locally) (4)
Already up to date (e.g. cherry-picked before) (3)
CONFLICTS — resolve the <<<<<<< markers (1):
  roles/php/defaults/main.yml (1 conflict(s))
```

The one conflict was the honest kind:

```yaml
<<<<<<< local
php_session_upload_progress_enabled: 0
=======
php_session_upload_progress_enabled: 'Off'
>>>>>>> v1.33.0
```

I had cherry-picked that setting before upstream released it, and upstream then spelled the value differently. The line right next to it, `php_sendmail_path` switching from ssmtp to msmtp, merged by itself. With `patch` I had fixed that line by hand.

After resolving that one line, I diffed the replay against the upgrade I had already made by hand and provisioned to production. They were identical, apart from a `mariadb_version` pin I added on purpose (more on that in [the upgrade write-up](/trellis-1-33-upgrade-msmtp-http3-mariadb-pin-apt-reboot/)).

## Guard rails worth having

Whatever tool you use, these made the difference:

- **Refuse a dirty tree.** If `trellis/` has uncommitted changes, stop. Then `git diff` shows exactly what the update did, and `git checkout -- trellis/` undoes it. That replaces the backup copy.
- **Dry run first.** Classify every upstream change before writing anything.
- **Never merge the project config.** Upstream's `hosts/`, `vault.yml` and `wordpress_sites.yml` are examples. Your vault files are encrypted, so a merge is meaningless. Save upstream's diff of those for reading instead.
- **Check for conflict markers before provisioning**, and skip the playbook syntax check until they are gone. Otherwise it fails with a confusing YAML error.
- **Read the release notes anyway.** A merge keeps your files intact. It cannot tell you that 1.33 renamed `nginx_ppa` to `nginx_repo_uri`, or that it changes the MariaDB default on existing servers.

## Using it

```bash
export TRELLIS_DIR=~/code/website.com/trellis
git checkout -b trellis-update
wp-ops trellis-updater --dry-run          # see the plan
wp-ops trellis-updater                    # merge, review, keep or undo
wp-ops trellis-updater --from=v1.28.0     # when there is no VERSION file and detection guesses wrong
```

Then provision development, commit and provision production. The exclude list is gone. The only thing left to maintain is your own changes, which is where it should have been all along.

---

*Merging upstream a different way, for example as a git remote with subtree? Find me on Mastodon at [@jfrumau@mastodon.social](https://mastodon.social/@jfrumau).*
