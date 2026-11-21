---
layout: post
title: "PHP 8.5 'Using null as an Array Offset' and a Fatal 'Headers Already Sent': The Culprit Was a NULL Row in wp_options"
seo_title: "WordPress PHP 8.5: Using null as an array offset in option.php:636 — fix the NULL option_name row in wp_options"
description: "After moving to PHP 8.5, wp-login.php and the frontend threw a deprecation in option.php:636 followed by a Symfony 'headers already sent' fatal. The cause was one corrupt wp_options row with a NULL option_name, allowed by a nullable legacy column. How I found it, ruled out plugins and a hack with wp-ops, and fixed it locally and on production."
date: 2026-11-21 09:00:00 +0700
categories: wordpress devops security
tags: [php, php-8-5, wp-options, mysql, wp-cli, acorn, sage, trellis, wp-ops, security, debugging]
case_category: devops
case_status: documented
---

After moving a local Bedrock/Trellis site to PHP 8.5, `wp-login.php` and the frontend started returning a 500. The log showed two errors back to back:

```
Deprecated: Using null as an array offset is deprecated, use an empty string instead
in /wp/wp-includes/option.php on line 636

Fatal error: Uncaught ErrorException: Cannot modify header information -
headers already sent by (output started at .../option.php:636)
in .../symfony/http-foundation/Response.php:328
```

The second error looks like a Symfony or Acorn bug. It isn't. It's a symptom.

## What actually happens

1. WordPress loads every autoloaded option in one query and builds an array keyed by `option_name`.
2. One row has `option_name = NULL`. PHP 8.5 deprecates using `null` as an array key, so it prints a notice.
3. The notice is written to the output before any HTTP headers are sent.
4. The theme's exception handler (Acorn on top of Symfony) then tries to send a `500` header. Headers are already sent, so it throws the "headers already sent" fatal you see.

On PHP 8.4 and older this row sat there silently. PHP 8.5 turned it into visible output, and that output broke everything after it.

## Finding the row

```sql
SELECT option_id, option_name, LEFT(option_value, 40) AS v, autoload
FROM wp_options
WHERE option_name IS NULL OR option_name = '';
```

In my case it returned exactly one row: a NULL name, an empty value, `autoload = yes`. That means it loads on every single request.

## Why was a NULL possible at all?

Core defines the column as `option_name varchar(191) NOT NULL default ''`. Mine looked like this:

```sql
`option_name` varchar(191) DEFAULT '',   -- nullable
ENGINE=MyISAM
-- sql_mode has no STRICT_TRANS_TABLES
```

The column was nullable, the table was MyISAM and strict mode was off. That is a legacy table state, probably from an old import or a host migration. With that schema, a NULL name can get in and nothing complains.

## Was it a plugin? Was it a hack?

I checked both before touching anything.

**Plugins and theme.** The code that writes to `wp_options` directly uses `$wpdb->prepare()` with constant names, and `prepare()` turns a null `%s` into `''`, not NULL. `add_option()` and `update_option()` reject empty names. So none of the code could have written it.

**The row itself.**
- Its ID was about 3.19M while the table's auto-increment was about 5.74M, so the row was old.
- Its value was empty. An injected option normally carries a payload.
- Local and production had the identical row, because the local DB was a copy of production.

**A security pass, run with wp-ops tooling over SSH:**
- Core checksums: verified.
- 18 of 19 plugins: checksums verified. The one failure (a Composer-installed plugin) only had extra files (store banners, screenshots, `composer.json`) and no modified code.
- Pattern grep of `web/app` for webshell signatures (`eval(base64_decode`, `system($_POST`, known shell names): no matches.
- PHP files in `uploads/`: none.
- Administrator accounts: one, the owner.

It wasn't an intrusion. It was a legacy schema accepting a bad row.

## The fix

Back up first, then delete the row and tighten the column. I did it locally and on production:

```bash
wp db export backup.sql          # or your host's backup tool
```

```sql
DELETE FROM wp_options WHERE option_id = 3192052 AND option_name IS NULL;
ALTER TABLE wp_options MODIFY option_name varchar(191) NOT NULL DEFAULT '';
```

Then flush the object cache, since the cached `alloptions` array still holds the null key:

```bash
wp cache flush
```

The `ALTER` makes it impossible to reintroduce a NULL name. Matching the core schema means this class of error can't come back.

## Check your own site before upgrading PHP

```bash
wp db query "SELECT COUNT(*) FROM wp_options WHERE option_name IS NULL OR option_name=''"
wp db query "SELECT COLUMN_NAME, IS_NULLABLE FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='wp_options'
             AND COLUMN_NAME='option_name'"
```

If you get a count above zero, or `IS_NULLABLE = YES`, fix it before moving to PHP 8.5.

## Takeaways

- When the visible fatal is "headers already sent", look at the first output, not the exception. The earlier deprecation notice is the real cause.
- PHP 8.5 is stricter about `null` array offsets. Old data that never mattered can now break a site.
- A dev copy of your database is a cheap early warning. It caught this before production moved to 8.5.
- Compare your table schemas against core. Old MyISAM or nullable columns are worth normalising.
