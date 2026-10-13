---
layout: post
title: "Safe Plugin Updates on a Plesk Site: WP Toolkit's WP-CLI, an FTP Download and Batches"
date: 2026-10-13 10:00:00 +0700
categories: wordpress plesk wp-cli devops
tags: [wordpress, plesk, wp-toolkit, wp-cli, backup, database, plugins, updates, ftp]
case_category: devops
case_status: documented
---

A client site had 20 pending updates. I had WordPress admin, a Plesk login and FTP, but no SSH. The site ran a custom theme that leans on ACF Pro and Gravity Forms, and two of the pending updates were major versions. I didn't want to click "Update all" and hope.

This is the routine I followed: a database backup with the WP-CLI console built into Plesk's WP Toolkit, an FTP download, a quick check that the dump is complete, a version inventory to roll back from, and then updates in batches by risk. It takes about 15 minutes before the first update, and all of it can be repeated on the next site.

## Why not just use Plesk's backups?

Plesk already had nightly incremental backups for this account, which is good, but they weren't the right tool for rolling back a plugin update:

- **They cover the whole subscription.** The subscription hosted more than one site. Restoring it to undo a broken plugin risks rolling back a site you never touched, unless you pick through the restore options very carefully.
- **They're from last night.** Anything changed since then, such as a content edit made this morning, would be lost in a restore.
- **No per-site snapshot.** I went looking for WP Toolkit's per-site backup. On this server, every backup button led to the full subscription backup in Backup Manager.

What a plugin update changes is the database (migrations, new options) and the plugin's own files. So that's what to secure.

## Step 1: Export the database with WP Toolkit's WP-CLI

In Plesk, open the site in WP Toolkit and click **WP-CLI**. You get a single command field with `wp` already filled in, so you type everything after it. There's no shell, so no pipes, `gzip` or `ls`. That's fine, because `wp db export` does the whole job:

```
db export ../site-pre-updates-2026-10-13.sql
```

The `../` matters. It writes the dump one level **above the web root**, so it can't be downloaded by URL, whatever it's called. If your account can't write there, drop the `../` and remember to delete the file from the web root afterwards.

Expected output:

```
Success: Exported to '../site-pre-updates-2026-10-13.sql'.

WARNING: option --ssl-verify-server-cert is disabled, because of an insecure passwordless login.
```

The warning comes from the MariaDB client about a local socket connection and is harmless here.

## Step 2: Download it over FTP

Connect over FTP, go one level up from the web root, and download the `.sql` file to your machine. Now you have a copy that doesn't depend on the server.

If the folder you download into is a git repo, as my per-client notes folder is, ignore the dump **before** you forget:

```gitignore
backups/
*.sql
*.sql.gz
```

A database dump contains user accounts, password hashes and form entries. It should never be committed, private repo or not.

## Step 3: Check that the dump is complete

Don't trust a backup you haven't looked at. Three quick checks on your machine:

```bash
ls -lh backups/site-pre-updates-2026-10-13.sql          # not zero, plausible size
grep -c 'CREATE TABLE' backups/site-pre-updates-2026-10-13.sql   # table count
tail -c 200 backups/site-pre-updates-2026-10-13.sql     # ends with "Dump completed on ..."
```

Mine was 13.7 MB with 35 tables and ended with `-- Dump completed on 2026-10-13  3:26:20`. A missing "Dump completed" line means the export was cut off. If the table count looks low, compare it with `db tables` in the WP-CLI console.

## Step 4: Record versions before changing anything

Back in the WP-CLI console, run three read-only commands:

```
plugin list --fields=name,status,version,update_version
```
```
theme list --fields=name,status,version,update_version
```
```
core check-update
```

Paste the output into your notes. That list is your file-level rollback. For anything from wordpress.org, going back is one command:

```
plugin install <slug> --version=<old-version> --force
```

**Paid plugins are the exception.** ACF Pro, Gravity Forms and its add-ons can't be reinstalled from wordpress.org at an older version. Before updating them, zip their folders in Plesk's File Manager (`wp-content/plugins/gravityforms` → *Add to archive*), or download the current version from the vendor's account.

## Step 5: Sort the updates by risk

The version list tells you what's pending. The theme code tells you what's dangerous. On this site:

- **Major version jumps:** Gravity Forms 2.10 → 3.1, Smush 3 → 4, GTM4WP 1 → 2, and Yoast 25 → 28.
- **Plugins the theme calls directly.** A grep through the theme turned up custom Gravity Forms submit buttons. A `gform_submit_button_{id}` filter replaced the button markup with HTML that calls `window.gform.submission.handleButtonClick()`. If a major Gravity Forms release changes that JavaScript API, every form on the site stops submitting, and nobody notices until enquiries stop coming in.
- **Plugins that hold content structure.** The theme registered no post types itself. The `team-members` post type behind the agent photos came from Custom Post Type UI, so an innocent-looking minor update to it could still break the front end.
- **The custom theme's name.** A custom theme whose folder name happens to match a theme on wordpress.org can show an "update". Never apply it, or your theme gets replaced with someone else's. Here the custom theme showed no update, but check every time.

```bash
grep -rn "gform_\|register_post_type\|acf_\|get_field" --include='*.php' wp-content/themes/your-theme | head
```

The result is a set of batches:

| Batch | What | Check afterwards |
|---|---|---|
| 1 | Inactive default themes, small utility plugins (WP Crontrol, Duplicate Page, SVG Support, WP Mail SMTP, CPT UI), inactive plugins | Front end loads, custom post types still render |
| 2 | ACF Pro (minor version, but the whole theme depends on it) | Blocks, theme options, listing pages |
| 3 | Yoast, Smush, GTM4WP, one at a time | Images lazy-load, `GTM-` still in page source |
| 4 | Gravity Forms + reCAPTCHA + related add-ons, together and last | A real test submission, notification email, entry in admin |

## Step 6: Update a batch, then check from outside

Batch 1 in the WP-CLI console:

```
theme update twentytwentyfive twentytwentyfour twentytwentyone twentytwentythree twentytwentytwo
```
```
plugin update wp-crontrol duplicate-page svg-support wp-mail-smtp custom-post-type-ui google-site-kit updraftplus
```

Then flush the page cache (LiteSpeed in this case) and check the live site from your own machine, bypassing any cache with a query string:

```bash
for u in "" some-listing-page/ another-key-page/; do
  curl -sL -o /tmp/p.html -w "$u HTTP %{http_code} %{time_total}s\n" \
    "https://example.com/$u?nocache=$(date +%s)"
  grep -qi "critical error\|Fatal error" /tmp/p.html && echo "  PHP ERROR on /$u"
done
```

A 200 status with no "critical error" is the minimum. Then check what this site specifically depends on. Here that was the agent name and photo on each listing card and the team section, so I counted those in the HTML.

## Step 7: Confirm the versions with WP-CLI, not the admin badge

After batch 1, the admin still said **20 updates** and listed WP Crontrol at its old version. WP-CLI said otherwise:

```
plugin list --fields=name,version,update_version
```

Every plugin in the batch showed its new version and an empty `update_version`. The admin was showing an old count from before the updates, and reloading the Updates screen cleared it. Trust `plugin list`, not the badge.

## Step 8: Get approval before the risky batches

This site is managed through an agency, and extra work only gets paid if it was agreed beforehand. Batch 1 was small enough to include in time already being billed. For batches 2–4 I sent a short message instead: which updates are pending, why Gravity Forms 3 needs care, a time estimate, and a request to go ahead. Do the risky work after a yes, not before.

## Cleanup

When the updates are done, or if they're postponed, delete the server-side dump:

- In Plesk's File Manager, go one level above the web root and delete `site-pre-updates-*.sql`.
- Keep the local copy until the site has run cleanly for a few days.

## The checklist

```
1. WP Toolkit → WP-CLI:  db export ../site-pre-updates-YYYY-MM-DD.sql
2. FTP: download the dump, keep it out of git
3. Verify: size, CREATE TABLE count, "Dump completed" footer
4. WP-CLI: plugin list / theme list / core check-update → save as rollback reference
5. Archive paid plugin folders (File Manager) before updating them
6. Grep the theme for plugin hooks; sort updates into risk batches
7. Per batch: update → flush cache → curl check → plugin list to confirm
8. Ask before major or billable updates
9. Delete the server-side dump
```

If you only have FTP and no control panel at all, the database step is harder. I covered a PHP-script approach in [WordPress Database Backup When You Only Have FTP]({% post_url 2026-09-21-wordpress-database-backup-ftp-only-no-ssh %}).

This is the kind of routine maintenance we do for client WordPress sites at [Imagewize](https://imagewize.com). If your sites are carrying a pile of pending updates that nobody dares to click, [get in touch](https://imagewize.com/contact-us/).

---

*Do you do plugin updates differently on Plesk? Find me on Mastodon at [@jfrumau@mastodon.social](https://mastodon.social/@jfrumau).*
