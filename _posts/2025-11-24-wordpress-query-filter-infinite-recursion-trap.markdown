---
layout: post
title: "The WordPress Query Filter Trap: How I Caused Infinite Recursion and Crashed Production"
date: 2025-11-24 14:00:00 +0700
categories: wordpress php debugging
tags: [wordpress, php, debugging, filters, wpdb, recursion, woocommerce]
---

# The WordPress Query Filter Trap: How I Caused Infinite Recursion and Crashed Production

I wrote some code a month ago that finally crashed a production WordPress site today. The bug sat dormant for 4 weeks before exploding. This post documents the error so others (and future me) don't repeat it.

## The Scenario

During an extensive PHP-FPM memory debugging session, I was trying to suppress some harmless WooCommerce database warnings. These warnings occur when WooCommerce tries to add database indexes that already exist:

```
WordPress database error Duplicate key name 'session_expiry'
```

The warnings cluttered the debug log but were harmless - WooCommerce handles them gracefully.

## The Broken Code

I added this filter to `setup.php`:

```php
add_filter('query', function ($query) {
    global $wpdb;

    if (
        strpos($query, 'ADD KEY `session_expiry`') !== false ||
        strpos($query, 'ADD INDEX woo_idx_comment_date_type') !== false
    ) {
        // Suppress errors and execute the query ourselves
        $suppress_errors = $wpdb->suppress_errors();
        $wpdb->suppress_errors(true);

        $result = $wpdb->query($query);  // ← THE BUG

        $wpdb->suppress_errors($suppress_errors);

        return '';  // Prevent original query from running
    }

    return $query;
}, 1);
```

Can you spot the bug?

## The Problem: Recursive Filter Trigger

The `query` filter runs on **every** database query WordPress makes. When you call `$wpdb->query()` inside the `query` filter, it triggers the same filter again:

```
1. WordPress runs ALTER TABLE query
2. 'query' filter intercepts it
3. Filter calls $wpdb->query($query)
4. $wpdb->query() triggers 'query' filter
5. Filter intercepts the same query again
6. Filter calls $wpdb->query($query)
7. ... infinite loop ...
8. PHP crashes: "Maximum call stack size reached"
```

The error message was:

```
PHP Fatal error: Uncaught Error: Maximum call stack size of 8339456 bytes
(zend.max_allowed_stack_size - zend.reserved_stack_size) reached.
Infinite recursion? in /wp-includes/class-wpdb.php:2412
```

## Why It Took 4 Weeks to Crash

Here's the scary part: this code was deployed on **October 27, 2025**. The site ran fine for almost a month before crashing on November 24.

Why? The bug only triggers under specific conditions:

1. WooCommerce must run an `ALTER TABLE ... ADD KEY` query
2. These queries don't run on every page load
3. They typically run during:
   - WooCommerce database updates
   - Session table maintenance
   - Certain admin operations
   - Plugin updates that trigger dbDelta

For 4 weeks, those specific queries never ran. Then something triggered them (possibly a cron job, admin action, or WooCommerce maintenance task), and the site immediately crashed.

## Why I Missed It During Code Review

I reviewed this code when I wrote it. Here's why I missed the bug:

1. **Context blindness**: I was focused on suppressing errors, not recursion
2. **The logic looked correct**: Intercept query → execute with suppressed errors → return empty
3. **No immediate failure**: The bug doesn't manifest until those specific queries run
4. **Fatigue**: After hours of debugging other issues, attention to detail drops

## The Fix

The solution is embarrassingly simple. We don't need to execute the query at all - just skip it:

```php
add_filter('query', function ($query) {
    if (
        strpos($query, 'ADD KEY `session_expiry`') !== false ||
        strpos($query, 'ADD INDEX woo_idx_comment_date_type') !== false
    ) {
        // Just skip this query entirely
        // WooCommerce handles missing indexes gracefully
        return '';
    }

    return $query;
}, 1);
```

WooCommerce doesn't actually need these `ADD KEY` queries to succeed. The indexes either exist (query fails harmlessly) or don't exist (WooCommerce works fine without them). By returning an empty string, we simply skip the query.

## The Rule

**Never call `$wpdb->query()`, `$wpdb->get_results()`, or any database method inside the `query` filter.**

If you need to run a different query inside the filter, you must:

1. Remove the filter first
2. Run your query
3. Re-add the filter

```php
add_filter('query', function ($query) use (&$my_filter_callback) {
    if (needs_modification($query)) {
        // Remove ourselves to prevent recursion
        remove_filter('query', $my_filter_callback, 1);

        // Now safe to query
        $result = $wpdb->query($modified_query);

        // Re-add ourselves
        add_filter('query', $my_filter_callback, 1);

        return '';
    }
    return $query;
}, 1);
```

But honestly, if you find yourself doing this, there's probably a better approach.

## Other Dangerous Filter Combinations

This pattern can bite you with other WordPress filters too:

| Filter | Don't call inside it |
|--------|---------------------|
| `query` | `$wpdb->query()`, `$wpdb->get_*()` |
| `the_content` | `apply_filters('the_content', ...)` |
| `wp_insert_post_data` | `wp_insert_post()`, `wp_update_post()` |
| `save_post` | `wp_update_post()` without removing hook |
| `pre_get_posts` | `new WP_Query()` without precautions |

## Lessons Learned

1. **The `query` filter is powerful but dangerous** - it intercepts ALL database queries
2. **Never call the function that triggers a filter from inside that filter**
3. **Simple solutions are usually better** - returning empty string was safer than trying to execute with error suppression
4. **Code review fatigue is real** - after hours of debugging, take a break before adding new code
5. **Test edge cases** - the bug only triggered on specific queries that don't run often

## Debugging Tip

If you see "Maximum call stack size reached" or "Infinite recursion?" in PHP 8.2+, check your filters. Look for:

- Filters that call functions which trigger the same filter
- Recursive action hooks (save_post calling wp_update_post)
- Circular dependencies between filters

The stack trace usually shows the same function appearing multiple times - that's your recursion.

## Conclusion

I spent a weekend debugging PHP-FPM memory issues, found and fixed five different root causes, then found a new unrelated bug the next day that crashed the site and could have crashed it for weeks. The irony isn't lost on me.

The silver lining: this mistake is now documented, and I'll never make it again. Hopefully you won't either.

---

*Have you been bitten by recursive WordPress filters? Share your war stories in the comments.*
