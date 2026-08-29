---
layout: post
title: "The Seven Commands I Actually Run Every Day (And Why I Stopped Memorizing Them)"
date: 2026-08-29 10:00:00 +0700
categories: wordpress trellis wp-cli devops
tags: [wordpress, trellis, wp-cli, ansible, cli, monitoring, security, github, bedrock]
case_category: devops
case_status: shipped
---

{% raw %}
For a long time, my daily WordPress ops routine lived in shell history. Pull a database, sync some uploads, eyeball a security log, glance at a client site's traffic — each one a slightly-different `ssh` one-liner or `ansible-playbook` invocation I'd half-remember and then grep my own history for. Multiply that by a dozen client sites on Trellis, each with its own site key, and "half-remember" starts costing real minutes every single day.

The fix wasn't a better memory. It was collapsing everything into one catalog: [wp-ops](https://github.com/imagewize/wp-ops), a single CLI that wraps the Ansible playbooks, WP-CLI scripts, and shell utilities I'd built up over time into one binary with real `--help`, search, and shell completions. Here's the actual loop I run against it — daily and weekly — and what each command is doing underneath.

## Why one binary instead of a folder of scripts

Before `wp-ops` existed, this was a directory of ~74 things: Ansible playbooks under `trellis/`, standalone Bash under `scripts/`, WP-CLI PHP under `wp-cli/`. All useful, all discoverable only if you already knew the filename. The CLI auto-discovers all of it from manifest comments at the top of each script:

```bash
# @desc     Back up a site's database from any environment
# @category backup
# @platform trellis
# @requires ansible-playbook
# @example  wp-ops database-backup imagewize.com production
```

That manifest is the whole trick — `wp-ops --help`, `wp-ops search`, and shell completions are all generated from it, so there's no second list to keep in sync. Run `wp-ops doctor` once after installing and it tells you which of the underlying tools (WP-CLI, Ansible, `gh`, ImageMagick…) are actually on your machine before a command fails halfway through.

```bash
brew install imagewize/tap/wp-ops
wp-ops init      # shell completions
wp-ops doctor    # check dependencies
```

With that in place, here's the loop. The examples below use our own site keys — `imagewize.com` for the main site, `demo.imagewize.com` for our local pattern-showcase install — swap in whatever key matches your project's entry in `wordpress_sites.yml`.

## 1. Database backup

```bash
wp-ops database-backup imagewize.com production
```

Runs `trellis/backup/database-backup.yml` against the target environment: `wp db export` on the remote, gzipped, pulled down as a timestamped `imagewize_com_production_2026_08_29_10_00_00.sql.gz`. I run this before anything that touches production data, not just on a schedule.

## 2. Database pull, with URL search-replace already done

```bash
wp-ops database-pull imagewize.com production
```

This is the one that looks simple and isn't. `database-pull.yml` doesn't just fetch a dump — it backs up your *current local* database first, into a `database_backup/` folder inside the project, before it imports anything. That's easy to miss because it's buried in the middle of the playbook, but it's the difference between "oops, wrong environment" being an inconvenience versus a lost afternoon.

After the import it runs the URL swap itself:

```yaml
url_from: "{{ wordpress_sites[site].site_hosts.0.canonical }}"
url_to:   "{{ dev_wordpress_sites.wordpress_sites[site].site_hosts.0.canonical }}"
```

resolving both sides from `group_vars` — production's canonical hostname and your local `local_path` config — so `wp search-replace` runs with the right values without you typing either URL. I wrote up the playbook's internals (and two bugs I had to patch in the stock version) in [an earlier post]({% post_url 2026-02-27-trellis-database-pull-playbook-explained %}) if you want the full mechanics.

## 3. Files pull via rsync

```bash
wp-ops files-pull imagewize.com production
```

Syncs `shared/uploads/` from the remote into `web/app/uploads/` locally. It's additive by default — local-only files (test images, things since deleted from the remote media library) survive the sync. Add `--delete yes` only when you actually want local to mirror remote exactly; that flag is destructive on the local side, so I don't reach for it without a reason.

## 4. Dropping a pattern onto a page to test it

This one isn't a single wp-ops command yet — it's a `wp post update` run against the Trellis VM, and it's the step I reach for most when a new block pattern needs a real page to render on before it ships. I do this against `demo.imagewize.com`, our local showcase site, rather than risk it on a client project:

```bash
trellis vm shell --workdir /srv/www/demo.imagewize.com/current -- bash << 'VMEOF'
cat > /tmp/page-content.html << 'EOF'
<!-- wp:pattern {"slug":"nynaeve/pattern-slug"} /-->
EOF
CONTENT=$(cat /tmp/page-content.html)
wp post update PAGE_ID --post_content="$CONTENT" --url=https://demo.imagewize.test/ --path=web/wp
VMEOF
```

The trap here isn't the command, it's what happens after: any pattern using `get_template_directory_uri()` bakes an *environment-specific* URL straight into `post_content` — `http://demo.imagewize.test/app/themes/nynaeve/patterns/images/foo.webp`. That's fine on local. It is not fine if that content ever reaches production without a search-replace pass first, since it'll silently serve broken images or trip mixed-content warnings. I run a URL audit before anything with test patterns in it goes near a production database — worth building into your own checklist if you do content work this way.

## 5. Security checkup

```bash
wp-ops security-scan imagewize.com production
wp-ops security-scan imagewize.com production --hours 48 --threshold 50
```

Scans Nginx access logs on the target for attack signatures — repeated `wp-login.php` hits, SQL-injection strings, scanner user-agents — over a configurable window, flagging any IP over the request threshold. For file-level malware checks instead of log analysis, that's a separate WP-CLI pass: `wp eval-file wp-cli/security/scanner-wrapper.php` run on the server, which is closer to a monthly job than a daily one.

## 6. Monitor checkup

```bash
wp-ops quick-status imagewize.com production
```

for the fast version — recent status codes, error counts, service status, good for "is this site okay right now." The Nginx and PHP-FPM status checks used to fail outright with `Missing sudo password`: the playbook had `become: yes` on those two tasks, but `systemctl status` is a read-only query that doesn't need root, and there's no password source when the command runs non-interactively. Dropped `become` from both tasks so they run as the regular deploy user, matching the other read-only monitoring playbooks in the repo.

When I want the fuller picture — traffic, security, AI-crawler activity, and error logs together, saved as a timestamped report — that's:

```bash
ssh web@imagewize.com 'bash -s' < scripts/monitoring/monitor.sh
```

streamed over SSH stdin rather than installed on the server, so there's nothing left behind to clean up afterward.

## 7. GitHub traffic across the main repos

```bash
wp-ops gh-traffic imagewize/wp-ops imagewize/nynaeve imagewize/aludra imagewize/elayne imagewize/aviendha imagewize/ixian --all
```

Pulls views, clones, and referrers for each repo via GitHub's traffic API — `--all` gets you every section, `--quiet` drops table headers if you're piping the output somewhere. GitHub only retains 14 days of this data, so I run it weekly rather than let a slow week's numbers age out unseen. `imagewize.com` itself is private, so it's left out here — the traffic API is really only worth checking on the public repos anyway.

## The point of collapsing this into a CLI

None of these seven things were hard to run individually — every one of them already existed as a playbook or script before `wp-ops` did. What was hard was *remembering which one and with what flags*, across a dozen site keys, without pasting a domain into the wrong environment. Manifest-driven discovery means the catalog documents itself: `wp-ops search backup`, `wp-ops <command> --help`, and the interactive picker all read from the same source the commands themselves declare, so the list can't drift out of sync with what's actually runnable.

This is part of the tooling we run at [Imagewize](https://imagewize.com) for client WordPress operations on Trellis. If your team is drowning in the same kind of scattered-script sprawl, [get in touch](https://imagewize.com/contact-us/).

---

*Questions about your own Trellis workflow? Find me on Mastodon at [@jfrumau@mastodon.social](https://mastodon.social/@jfrumau).*
{% endraw %}
