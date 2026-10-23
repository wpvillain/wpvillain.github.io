---
layout: post
title: "Site Health Says Too Many Autoloaded Options: Find the Culprits with WP-CLI Before You Touch Anything"
date: 2026-10-23 10:00:00 +0700
categories: wordpress performance wp-cli
tags: [wordpress, performance, wp-cli, database, site-health, options, woocommerce]
case_category: performance
case_status: documented
---

A client's Site Health screen showed this warning:

> Your site has 1364 autoloaded options (size: 2 MB) in the options table, which could cause your site to be slow.

The advice WordPress gives is "review the options being autoloaded and remove any that are no longer needed." That's not much to go on. You don't know which of 1,364 rows matter, and deleting options on a live WooCommerce site on a hunch is how you break things.

Before changing anything, I ran three read-only queries to see where the weight is. This is that check, so I can reuse it.

## What autoload does, and when the warning fires

Every row in `wp_options` has an `autoload` flag. Rows flagged to autoload are fetched in a single query at the start of every request and kept in memory, whether or not that request needs them. That is fine for a few hundred small settings. It hurts when a plugin stores a large blob there that only one admin screen reads.

Site Health warns when the autoloaded total passes about 800 KB. The row count in the message is secondary. Size is what matters.

## Check on a copy, not on production

I ran this against a local copy of the site first. The copy was a few months old, so the numbers differ slightly from the live site (1,265 options and 2.4 MB locally, against 1,364 and about 2 MB in Site Health). The biggest offenders don't change much between a copy and the live site, so a copy is enough to find them. Confirm on production before you change anything there.

`SELECT` statements only, so nothing is modified.

## Query 1: the total

```sql
SELECT COUNT(*) n, ROUND(SUM(LENGTH(option_value))/1024) kb
FROM wp_options
WHERE autoload IN ('yes','on','auto','auto-on');
```

The `IN (...)` list matters. Older WordPress stores `yes`. Since 6.6 it can also store `on`, `auto` and `auto-on`. Matching only `yes` undercounts.

Run it with WP-CLI:

```
wp db query "SELECT COUNT(*) n, ROUND(SUM(LENGTH(option_value))/1024) kb FROM wp_options WHERE autoload IN ('yes','on','auto','auto-on');"
```

Result on the copy: 1,265 options, 2,412 KB.

## Query 2: the biggest single rows

```sql
SELECT option_name, ROUND(LENGTH(option_value)/1024) kb
FROM wp_options
WHERE autoload IN ('yes','on','auto','auto-on')
ORDER BY LENGTH(option_value) DESC
LIMIT 15;
```

This is where the answer was:

| Option | Size | Source |
|---|---|---|
| `ct_svg_sets` | 746 KB | Oxygen builder icon sets |
| `ct_svg_sets_Font Awesome 0` | 567 KB | Oxygen |
| `ct_svg_sets_Linearicons 0` | 180 KB | Oxygen |
| `oxygen_vsb_element_presets` | 160 KB | Oxygen |
| `oxygen_vsb_google_fonts_cache` | 107 KB | Oxygen |
| `jetpack_static_asset_cdn_files` | 71 KB | Jetpack |
| `omgf_pro_processed_local_stylesheets` | 56 KB | OMGF Pro |

Three icon-set options account for about 1.5 MB, which is roughly 60% of the whole 2.4 MB. After that the sizes fall off fast. Everything below the top seven is under 40 KB.

## Query 3: group by prefix

The count in the warning is about how many rows there are. Grouping by the first two parts of the name shows which plugin owns them:

```sql
SELECT SUBSTRING_INDEX(option_name,'_',2) prefix, COUNT(*) n,
       ROUND(SUM(LENGTH(option_value))/1024) kb
FROM wp_options
WHERE autoload IN ('yes','on','auto','auto-on')
GROUP BY prefix
ORDER BY n DESC
LIMIT 12;
```

Here it showed `oxygen_vsb` with 110 rows (281 KB) and `woocommerce_flat` with 89 rows (158 KB, the shipping zone settings). The other groups were small. So the row count of 1,364 looks scary but is ordinary for a WooCommerce site. Only the size is a real problem, and a handful of rows cause it.

## Don't assume the big rows are unused

My first guess was that the icon sets are only read in the builder. That was wrong. Reading the Oxygen plugin source showed `oxy_get_svg_sets()` is also called by the Fancy Icon and SVG Icon components when they render on the front end. With autoload off, those rows are fetched with separate queries, and only on requests that need them. That's still cheaper than loading 1.5 MB on every request, including admin, cron and AJAX, but it needed testing, not an assumption.

The plugin also has its own switch. `oxygen_options_autoload` is set to `yes` or `no`, and Oxygen passes it as the autoload argument every time it saves these options. On this site it was `yes`. If you only flip the rows, the next save in the builder flips them back. The code in `updates.php` sets `no` on fresh installs and `yes` on installs that already hold Oxygen data. I found no public changelog that mentions it, so that part is my reading of the code, not documented behavior.

## What I did

1. **Back up the database.** Production had `exec()` disabled, so `wp db export` wasn't an option. I read the credentials with `wp config get` and ran `mysqldump` over SSH: 20.8 MB, 151 tables.
2. **Test on a copy first.** I measured uncached requests (5 per page) on two pages that use icons, with autoload on and then off:

| Page | Autoload on | Autoload off |
|---|---|---|
| `/contact/` | 0.392s | 0.373s |
| `/about/` | 0.371s | 0.357s |

   The HTML came out byte-identical with the same SVG symbols, and the autoloaded total on the copy dropped to 651 KB.
3. **Apply it on production.** Five rows, plus Oxygen's setting:

```
wp option set-autoload ct_svg_sets no
wp option set-autoload "ct_svg_sets_Font Awesome 0" no
wp option set-autoload "ct_svg_sets_Linearicons 0" no
wp option set-autoload oxygen_vsb_google_fonts_cache no
wp option set-autoload oxygen_vsb_element_presets no
wp option update oxygen_options_autoload no
wp cache flush
```

   This ran on WP-CLI 2.12.0. I haven't checked which older versions have `set-autoload`.
4. **Re-run the total query.** 1,359 options, **674 KB**. Reloading Site Health showed the warning gone.

To undo it, set the five rows back to `yes` and set `oxygen_options_autoload` back to `yes`.

## Checking the builder

After the cache purge I opened the Oxygen builder as an administrator, without saving. The icon picker loaded the Linearicons set and found the icon, and the Font Family search worked, so the options I'd moved off autoload are still read when they're needed.

## Will a builder save undo it?

I didn't want to click Save on a live client page to find out, so I tested on the local copy. Oxygen's save handler writes these options with `update_option($name, $value, get_option("oxygen_options_autoload"))`. I ran exactly those calls on the copy, changing each value so WordPress really wrote it, then restored the originals. I ran it twice:

| `oxygen_options_autoload` | Rows after a save |
|---|---|
| `no` | Stay out of autoload |
| `yes` (the original value) | Flip back to autoload |

So changing Oxygen's own setting was necessary, not optional, and it holds across saves. The element presets were readable (3 entries), and `oxy_get_svg_sets()` still returned both the Font Awesome and Linearicons sets. WordPress stores "not autoloaded" as `no` or `off` depending on how it was set. Both mean the same thing, and the total query confirmed it.

## What I didn't check

- I replicated the save calls rather than clicking Save in the builder, because the real save needs a session and a nonce, and I didn't want to do it on a live client page.
- One page showed 6 SVG symbols on production against 7 on the copy. After purging the page cache from the WP Rocket admin bar (`wp rocket clean` isn't a registered command on this site), I re-checked: every `<use>` on both pages has a matching `<symbol>`, so no icon is missing. The live page most likely uses one fewer icon than the copy, but I had no pre-change production number to prove it.

## Shared hosting note

On hosts that disable `exec()`, `wp db query` can fail. The workaround is `wp eval` with `$wpdb`:

```
wp eval 'global $wpdb; print_r($wpdb->get_results("SELECT COUNT(*) n, ROUND(SUM(LENGTH(option_value))/1024) kb FROM {$wpdb->options} WHERE autoload IN (\"yes\",\"on\",\"auto\",\"auto-on\")"));'
```

## Takeaways

- Read the size in the warning, not the count.
- Three queries (total, top 15 by size, grouped by prefix) are enough to name the cause. On this site it was one plugin's icon sets: five rows, about 1.8 MB.
- Turn autoload off on the big rows before deleting anything. It's reversible, and it took the total from 2.4 MB to 674 KB.
- Check whether the plugin has its own autoload setting, or it will undo your change on the next save.
- Don't assume a big row is unused. Read the plugin source for where it's called, then compare pages with autoload on and off.
