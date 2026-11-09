---
layout: post
title: "Cleaning 78 Orphan Plugin Tables Out of a WordPress Database: 20% Smaller, No Speed Gain, and the Backup Bugs I Hit First"
seo_title: "WordPress Orphan Plugin Tables: 78 Dropped, 20% Smaller DB"
date: 2026-11-09 16:00:00 +0700
categories: wordpress devops database
tags: [wordpress, mysql, mariadb, wp-cli, trellis, backups, devops, database]
case_category: devops
case_status: shipped
---

I pulled the imagewize.com production database to my laptop this morning and scrolled past tables named `wp_wfHits`, `wp_wprc_repositories` and `wp_revslider_slides`. Wordfence, an old WPML/Toolset installer and Revolution Slider. None of them had been installed in years.

Cleaning them out took a morning. Before I could do it safely, I found three problems with my own backup tooling. Then I measured what the cleanup actually bought me, and the answer is less than you'd think: the database is 20% smaller, backups are 27% smaller, and the pages are no faster.

## The backups I thought I had

Rule one before dropping anything: have a production backup you have *proven* restores. Checking that turned up three issues.

**The pull didn't keep the production dump.** My `db-pull` script (part of [wp-ops](https://github.com/imagewize/wp-ops)) backs up the *local* database before importing, then streams the production dump through `/tmp` in the VM and deletes it after import. The `dev_backup_*.sql.gz` it leaves behind looks like a production backup. It isn't one.

**The backup script pruned every older copy in one go.** A separate `db-backup` does save production dumps locally, with a hardcoded 30-day retention. I hadn't run it in a while, so its first run deleted 20 older dumps at once, including the only one from June.

**The `.sql.gz` files weren't gzipped.** `wp db export file.sql.gz` does not compress, whatever the extension says. The "backup" was 115 MB of plain SQL that `gunzip` refuses to open. Piped through gzip it is 16 MB:

```bash
# wrong: plain SQL with a .gz name
wp db export database_backup/dev_backup.sql.gz

# right
wp db export - | gzip > database_backup/dev_backup.sql.gz
```

All three are fixed in wp-ops 5.45.0:
- `db-pull` keeps both dumps.
- `db-backup` defaults to 180 days, never deletes the newest 10 (`--keep-days`, `--keep-min`, `--no-prune`), and only prunes its own environment's files.
- Both scripts check the dump before trusting it.

## Prove the dump restores

`gzip -t` only tells you the archive isn't corrupt. A dump cut short by a dropped SSH connection can still be valid gzip. Two cheap checks and one real one:

```bash
F=imagewize_com_production_2026_11_09_08_15_33.sql.gz
gzip -t "$F"                                   # archive intact
gzip -dc "$F" | tail -n 1                      # "-- Dump completed on ..."
gzip -dc "$F" | grep -c '^CREATE TABLE'        # 163
```

The real proof is importing it into a scratch database. The WordPress database user can't do that: it only has rights on its own database, so `CREATE DATABASE` fails with `ERROR 1044: Access denied`. On a [Trellis](https://roots.io/trellis/) box you don't need it. Trellis keeps the MySQL root password in its encrypted vault as `vault_mysql_root_password`.

One trap: `trellis vm shell` prints its full command line (`Running command => limactl shell ...`). Put the password in the arguments and it lands in your terminal scrollback. I did exactly that on my first try. Send the script on stdin with `bash -s` instead, which is echoed only as `bash -s`:

```bash
cd trellis
P=$(ansible-vault view group_vars/development/vault.yml \
  | sed -n 's/^vault_mysql_root_password:[[:space:]]*//p' | tr -d "\"'")

trellis vm shell --workdir /srv/www/example.com/current -- bash -s <<EOF
export MYSQL_PWD='$P'
mysql -uroot -e "CREATE DATABASE restore_check"
gzip -dc database_backup/$F | mysql -uroot restore_check
mysql -uroot restore_check -e "SELECT COUNT(*) FROM wp_posts"
mysql -uroot -e "DROP DATABASE restore_check"
EOF
```

It imported in 4.3 seconds: 163 tables, 5,789 posts, `home` = `https://imagewize.com`. Now I had a backup.

## What was actually in there

`wp plugin list` confirmed that none of these plugins were installed, not even inactive:

| Plugin | Tables |
|---|---|
| Wordfence + Login Security | 24 (`wp_wf*`, `wp_wfls_*`) |
| WPML | 20 (`wp_icl_*`) |
| Gravity Forms, new + legacy | 18 (`wp_gf_*`, `wp_rg_*`) |
| Revolution Slider | 7, including a backup table from 2016 |
| OTGS installer (WPML/Toolset) | 5 (`wp_wprc_*`) |
| Yoast SEO | 2 |
| WP Rocket | 2 |

That's 78 tables, plus 474 rows in `wp_options`.

`wp_wprc_repositories` deserves a mention. It held the installer's stored login details for WPML.org and Toolset. That data had been copied into every backup I'd ever taken, and it still is in the old ones.

## Three gotchas before the DELETE

**`_` is a wildcard in `LIKE`.** `option_name LIKE 'wpr_%'` doesn't mean "starts with `wpr_`". It means "starts with `wpr` plus any character", which also matches `wprc...`, `wpra...` and anything else. Escape the underscore, and run the same `WHERE` as a `SELECT` before you `DELETE`:

```sql
SELECT option_name FROM wp_options
WHERE option_name LIKE 'wpr\_%' OR option_name LIKE 'wfls\_%' OR option_name LIKE 'icl\_%';
```

**Some meta keys belong to the wrong-looking plugin.** Of the 112,234 postmeta rows, 18,347 belonged to things no longer installed: the JupiterX and Total themes, Yoast, Imagify, Jetpack, Visual Composer, Algolia. I grepped every key against the active theme and plugins before deleting it, and three would have bitten me:
- `_genesis_title` and `_genesis_description` look like the Genesis theme. They are where [The SEO Framework](https://theseoframework.com/) stores *its* titles.
- `homepage_builder_*` is 78k rows of ACF data for the current theme's front page.
- `footnotes` is WordPress core.

I also checked that no published post had a Yoast title without an SEO Framework one. None did.

**Real data hides in "orphan" tables.** `wp_gf_entry` held real form submissions going back years. I exported the 18 Gravity Forms tables to their own archive file, outside the auto-pruned backups, before dropping anything.

Then I ran the whole cleanup on dev first, smoke-tested the main pages, wp-admin, the sitemap, REST and the feed, took a fresh verified production backup, and ran the same SQL file in production. I listed every table by name in that file. A regex in the `DROP` statement would be faster to write, but I'd have had to trust it instead of reviewing it.

## What it bought

I measured on a local copy of production: restored the pre-cleanup dump, measured, applied the cleanup, measured again. Same data and same machine.

| | Before | After |
|---|---|---|
| Database size (data + indexes) | 143.2 MB | 115.2 MB (−20%) |
| Tables | 163 | 85 |
| `wp_options` rows | 1,527 | 1,054 |
| Autoloaded options | 247.6 KB | 215.6 KB (−13%) |
| `wp_postmeta` rows | 112,234 | 93,887 |
| Production backup, gzipped | 15 MB | 11 MB (−27%) |

Two things worth knowing:
- **Run `OPTIMIZE TABLE` afterwards.** InnoDB doesn't give space back on `DELETE`; the table size only drops after a rebuild.
- **Page speed didn't change.** Time to first byte was 435 ms before and about 435–460 ms after, across 15 requests per page. Two runs on identical data differed by more than the cleanup did. Production told the same story: the postmeta step took the live database from 126.3 to 114.2 MB, and TTFB stayed at about 570 ms for pages and about 810 ms for the REST API, before and after. That makes sense: WordPress never read those tables, and with Redis as the object cache, 32 KB less autoloaded data is nothing.

So this was housekeeping, not a speed fix. If someone sells you "database cleanup" as a performance boost, ask for the before and after TTFB. The real wins are smaller and faster backups, faster pulls to local, no stored third-party credentials in every dump, and a database I can actually read.

## The routine, in order

1. Take a production backup and prove it restores into a scratch database.
2. List orphan tables and options; confirm with `wp plugin list` that the plugins are really gone.
3. Grep every meta key against the active theme and plugins. Escape `_` in `LIKE`. `SELECT` before `DELETE`.
4. Archive anything that might be real data, such as form entries.
5. Run it on dev, smoke-test, take a fresh backup, then run the same SQL file in production.
6. `OPTIMIZE TABLE`, then measure, and report whatever the numbers say.
