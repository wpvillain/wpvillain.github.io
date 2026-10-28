---
layout: post
title: "Renamed a WordPress Multisite Subsite and WP-CLI Still Shows the Old Slug: A Site Path Is Cached Infrastructure"
date: 2026-10-28 09:00:00 +0700
categories: wordpress multisite wp-cli
tags: [wordpress, multisite, wp-cli, redis, object-cache, trellis, debugging]
case_category: debugging
case_status: documented
---

I renamed a subdirectory subsite on a Multisite network from `/fintech/` to `/kafe/`. I changed the path in the database and expected that to be the end of it. It was not. The site came out half renamed and half missing.

- `wp_blogs.path` said `/kafe/`.
- `wp site list` still printed `https://demo.example.com/fintech/`.
- `/wp-admin/network/site-info.php?id=6` loaded stale data.
- The renamed site seemed to take over the old one instead of being its own site.

Nothing had failed. The rename just was not one operation.

## The path lives in four places

| Layer | State after my edit |
| --- | --- |
| `wp_blogs` table | `/kafe/` (updated) |
| The site's own options (`wp_6_options`: `siteurl`, `home`) | still `/fintech/` |
| Persistent object cache (Redis) | cached the old blog path |
| Multisite blog lookup | still resolved `blog_id 6` to `/fintech/` |

The lookup from blog ID to path is cached, and with a persistent object cache that cache outlives the request. So WordPress kept answering from the cache while the database said something else. The database and the routing disagreed, and the cache won.

Editing `wp_blogs` directly is the trap. The Network Admin screen updates the site's options for you. A raw `UPDATE` does not.

## Fix all of it, in order

Run these from the Bedrock root. The `--url` flag selects the subsite, so use the new URL.

**1. Correct the site's own URL options.** Multisite does not touch them when the slug changes.

```bash
wp --url=https://demo.example.com/kafe option update siteurl https://demo.example.com/kafe --path=web/wp
wp --url=https://demo.example.com/kafe option update home https://demo.example.com/kafe --path=web/wp
```

**2. Replace the old path inside the site's content.** Skip the `guid` column, because GUIDs are identifiers and should not change.

```bash
wp --url=https://demo.example.com/kafe search-replace '/fintech/' '/kafe/' --skip-columns=guid --path=web/wp
```

Use `--dry-run` first. A short path like `/shop/` matches a lot of things you did not mean.

**3. Flush the object cache.**

```bash
wp cache flush --path=web/wp
```

With a Redis object cache plugin this clears the persistent cache as well, which is the step that fixes the stale lookup. If you reach for `redis-cli FLUSHALL` instead, know that it empties every Redis database on that server, including other sites sharing the instance. `wp cache flush` is the narrower tool when the plugin is active.

**4. Rebuild the rewrite rules.**

```bash
wp rewrite flush --hard --path=web/wp
```

Then check it:

```bash
wp site list --fields=blog_id,url --path=web/wp
```

It now showed `https://demo.example.com/kafe/` for blog 6, and the Network Admin link opened the right site.

## Checklist for the next rename

```bash
# after changing the slug
wp --url=<new-url> option update siteurl <new-url>
wp --url=<new-url> option update home <new-url>
wp --url=<new-url> search-replace '<old-path>' '<new-path>' --skip-columns=guid --dry-run
wp cache flush
wp rewrite flush --hard
```

Avoid two things:

- Renaming through the database only.
- Creating a new site on a slug you used before without flushing the cache. That one produces the "new site takes over the old one" symptom, because the cache still maps the old ID to that path.

## The lesson

In Multisite, a site slug is a cached routing key, not a string in one table. If the Network Admin did not make the change, assume nothing downstream knows about it, and clear the cache before you decide the site is broken.
