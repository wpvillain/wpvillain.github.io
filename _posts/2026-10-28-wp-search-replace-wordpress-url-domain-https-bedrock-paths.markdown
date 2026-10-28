---
layout: post
title: "Changing a WordPress Domain, HTTPS or Bedrock Paths with wp search-replace, and the Other Ways to Fix Site URLs"
date: 2026-10-28 23:30:00 +0700
categories: wordpress wp-cli bedrock
tags: [wordpress, wp-cli, search-replace, migration, https, bedrock, multisite, wp-config]
case_category: development
case_status: documented
---

After a migration the site loads and every link goes to the old domain, or the images 404 because the database still says `/wp-content/uploads/`. WordPress stores absolute URLs in many places: the `home` and `siteurl` options, post content, post meta, widgets and page builder data. Changing the setting in Settings, General is not enough.

`wp search-replace` is the safe way to rewrite them, because it understands serialized data. This is the set of commands I run, what the flags do, and the fallbacks for when you cannot reach the admin.

## The basic move

```bash
# Preview. Nothing changes.
wp search-replace 'https://old-domain.com' 'https://new-domain.com' --all-tables --dry-run

# Apply
wp search-replace 'https://old-domain.com' 'https://new-domain.com' --all-tables
```

Then rewrite the domain where it is stored without a protocol, as in some plugin settings:

```bash
wp search-replace 'old-domain.com' 'new-domain.com' --all-tables --dry-run
```

Look at the dry-run count before you run the second one. A bare domain is short enough to match things you did not mean to touch, such as an email address on the old domain.

## What the flags are for

| Flag | What it does |
|---|---|
| `--dry-run` | Reports what would change and changes nothing. Always run it first. |
| `--all-tables` | Includes tables that are not WordPress core tables, such as those added by plugins. |
| `--precise` | Does a slower, more careful replace using PHP, which is safer for serialized and encoded data. |
| `--report-changed-only` | Hides tables where nothing changed. Makes the output readable. |
| `--network` | On multisite, runs across every site in the network. |
| `--url=<site>` | Picks which site to run against on multisite. |

Take a backup first (`wp db export before-replace.sql`). A dry run tells you what would change; it does not undo the real run.

## HTTP to HTTPS

```bash
wp search-replace 'http://example.com' 'https://example.com' --all-tables --precise --report-changed-only --dry-run
wp search-replace 'http://example.com' 'https://example.com' --all-tables --precise --report-changed-only
```

If you still see mixed-content warnings afterwards, the leftovers are usually a protocol-relative URL (`//example.com/...`), a `www` variant, or a URL inside a theme file or a plugin option. Search the database for what remains:

```bash
wp db search 'http://example.com' --all-tables
```

## Moving to Bedrock paths

Bedrock calls the content directory `app`, so a site moved from a standard install has `/wp-content/` URLs in its database:

```bash
wp search-replace '/wp-content/themes/'  '/app/themes/'  --all-tables --dry-run
wp search-replace '/wp-content/themes/'  '/app/themes/'  --all-tables

wp search-replace 'https://example.com/wp-content/uploads/' \
  'https://example.com/app/uploads/' --all-tables --precise

wp search-replace '/wp-content/plugins/' '/app/plugins/' --all-tables
```

Finish by checking nothing is left:

```bash
wp db search 'wp-content/uploads' --all-tables
wp db search 'wp-content/themes'  --all-tables
```

Both should come back empty.

## Multisite

On a network, `search-replace` visits every subsite whose tables contain the string, so a replace you meant for one site can touch others. Scope it:

```bash
# One subsite
wp search-replace 'http://subsite.example.test' 'https://subsite.example.com' \
  --all-tables --url=subsite.example.test

# The whole network
wp search-replace 'http://subsite.example.test' 'https://subsite.example.com' \
  --all-tables --network --url=subsite.example.test
```

A real example, switching theme URLs to HTTPS on one subsite of a Bedrock network. The dry run first:

```bash
wp search-replace 'http://example.com/app/themes' 'https://example.com/app/themes' \
  --all-tables --precise \
  --url=https://example.com/spa --path=web/wp \
  --dry-run --report-changed-only
```

Read the table list. If it names only that subsite's tables, drop `--dry-run` and run it again. On a network, change the main site's URL options with `wp option update` and do the subsites one by one:

```bash
wp option update home    'https://newdomain.com' --url=olddomain.com
wp option update siteurl 'https://newdomain.com' --url=olddomain.com
```

## After the replace

```bash
wp cache flush
wp rewrite flush
```

Then test the front end, forms and anything that builds URLs dynamically, and check the browser console for 404s.

## Other ways to set the site URL

`search-replace` is the right answer when you can run WP-CLI. These are for when you cannot.

**Just the two options, with WP-CLI.** Enough to get the admin working again:

```bash
wp option update home    'https://newdomain.com'
wp option update siteurl 'https://newdomain.com'
wp rewrite flush
```

**`wp-config.php` constants.** If you are locked out of the admin, add these above the "stop editing" line. They override the database values:

```php
define( 'WP_HOME',    'https://newdomain.com' );
define( 'WP_SITEURL', 'https://newdomain.com' );
```

Treat this as a stopgap. Fix the database, then remove the lines. On Bedrock the same values come from `.env` as `WP_HOME` and `WP_SITEURL`.

**SQL.** For the two options:

```sql
UPDATE wp_options SET option_value = 'https://newdomain.com' WHERE option_name IN ('home', 'siteurl');
```

Be careful with `REPLACE()` on post content, post meta or options. It rewrites serialized values without fixing the length counts that PHP stores in them, which corrupts them. That is the reason to prefer `wp search-replace` over a hand-written query for anything beyond the two options.

**Settings, General in the admin.** Fine for a simple site you can still log in to. It changes only the two options, not the content.

## Checklist

- [ ] Database exported before the first replace
- [ ] Every replace run with `--dry-run` first
- [ ] Protocol, protocol-relative and `www` variants handled
- [ ] Remaining references checked with `wp db search`
- [ ] Caches and rewrite rules flushed
- [ ] Admin, front end, images and forms tested
- [ ] Old domain redirected to the new one, with SSL in place

---

*Run into a serialized-data case that `--precise` did not fix? Find me on Mastodon at [@jfrumau@mastodon.social](https://mastodon.social/@jfrumau).*
