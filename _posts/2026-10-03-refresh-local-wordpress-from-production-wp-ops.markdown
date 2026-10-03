---
layout: post
title: "Refreshing Three Local WordPress Sites From Production Without Leaving .com URLs Behind"
date: 2026-10-03 10:00:00 +0700
categories: wordpress trellis wp-cli devops
tags: [wordpress, trellis, wp-cli, wp-ops, bedrock, multisite, database, search-replace]
case_category: devops
case_status: shipped
---

{% raw %}
Every few weeks my local copies drift from production far enough that I stop trusting them: stale content, missing uploads, a plugin version that no longer matches. The fix is to replace the local databases with fresh production copies. The part that bit me once is doing it *half* right: importing a production dump but not rewriting the URLs, so every link on `example.test` quietly points at `example.com`.

This post is the checklist I now follow, written down after refreshing three sites in one sitting (a main site, a multisite demo network and a small marketing site, all on Trellis with a Lima VM).

## Pick the command that does the whole job

[wp-ops](https://github.com/imagewize/wp-ops) has two families of database commands, and they are not equivalent:

| Command | Backs up local first | Imports prod | Rewrites URLs |
|---|---|---|---|
| `wp-ops database-backup` | n/a | no (just exports remote) | no |
| `wp-ops database-pull` | yes | yes | yes (from `group_vars`) |
| `wp-ops db-pull` | yes | yes (streamed over SSH) | yes, plus multisite fixups |

`db-pull` is the one I reach for now. It streams `wp db export` from the remote straight into the VM's database with no intermediate file, and it runs `wp search-replace` twice (the full URL, then the home URL, covering `https://` and a stray `http://`). The thing I had previously done wrong was using a plain backup/download command and importing by hand, which skips the replace step entirely.

## Before you pull

1. **Is the VM running?** `trellis vm shell` drops you into a shell if so, and errors if not. The local databases live in the VM.
2. **Check what "local" means.** The replace target comes from `trellis/group_vars/development/wordpress_sites.yml`. If `site_hosts.0.canonical` is wrong there, the pull will faithfully rewrite everything to the wrong hostname.
3. **Export `TRELLIS_DIR`** to your Trellis directory so the playbooks find their inventory:

```bash
export TRELLIS_DIR=$PWD/trellis
```

## The pulls

```bash
wp-ops db-pull example.com production --yes
wp-ops db-pull demo.example.com production --multisite --yes
wp-ops db-pull small-site.com production --host example.com --yes
```

Two flags are easy to forget:

- **`--multisite`** for a network. It also fixes the `wp_blogs` and `wp_site` domain rows and scopes the search-replace with `--url`. Without it, subsites keep their production domains and the network breaks. On my demo network that was 9 rows corrected plus 93,000-odd link replacements in one run.
- **`--host`** when the site lives on a server whose SSH name differs from the site name. One of mine is hosted on another site's server, and SSH to its own hostname failed host-key verification, so the default (derive the host from the site name) can't work.

I run them one at a time. Each prints numbered steps (read dev URL, back up local, pull, import, replace, flush cache), and the "Made N replacements" lines are a quick sanity check: a main site with 88 replacements, a tiny site with 37.

Each run also writes `dev_backup_<timestamp>.sql.gz` into the site's `database_backup/` folder *before* importing. That's your undo button. Check that folder isn't tracked by git.

## Don't forget the uploads

The database pull doesn't touch `wp-content/uploads`. Without it you get correct pages with broken images:

```bash
wp-ops files-pull example.com production
```

Run it per site. It's rsync, so repeat pulls are cheap. I confirmed it worked by counting files afterwards (about 17,000 for the main site), because the Ansible recap says `skipped=4` even on success, which looks alarming and isn't.

## Verify, don't assume

Three checks per site, all through WP-CLI inside the VM:

```bash
wp option get home
wp option get siteurl
wp db query "SELECT COUNT(*) FROM wp_posts WHERE post_content LIKE '%://example.com%'"
```

`home` and `siteurl` should be the `.test` URLs, and the count should be **0**. A looser search for just `example.com` still returned a few hundred hits on the main site, and every one was an email address or plain-text mention. Searching for the scheme (`://`) is what separates real links from noise. On a multisite network also run `wp site list` and confirm every subsite shows the local domain.

## Side effects to expect

- **A modified `wp-config.php`.** After the production database landed, a 2FA plugin that was active locally wrote its encryption key into `wp-config.php`. It's an uncommitted change, and a secret, so don't commit it. Revert it with `git checkout`.
- **Shell gotcha.** I separated two commands with `echo =====` and zsh answered `=====: not found`, which aborted the rest of the line. The second pull silently didn't run until I noticed. Use `&&`, or run each command separately.
- **Theme state.** If your themes are Composer-installed and git-ignored, a database pull doesn't change them, but production's active theme and any page or template-part overrides now apply locally. If a recent theme fix doesn't show up, the content in the database is probably shadowing the theme files.

## The short version

```bash
export TRELLIS_DIR=$PWD/trellis
wp-ops db-pull <site> production --yes            # + --multisite / --host as needed
wp-ops files-pull <site> production
wp option get home && wp option get siteurl        # expect .test
```

Use the command that backs up, imports *and* replaces, pass the multisite and host flags where they apply, pull the uploads separately, and verify with a scheme-anchored search. That's the whole difference between a refresh I trust and one I have to redo.
{% endraw %}
