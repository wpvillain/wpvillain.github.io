---
layout: post
title: "Debugging PHP-FPM Memory Exhaustion on WordPress with WooCommerce and Trellis"
date: 2025-11-24 10:00:00 +0700
categories: wordpress php-fpm trellis woocommerce performance
tags: [wordpress, php, php-fpm, memory, woocommerce, trellis, nginx, debugging, performance, server]
---

# Debugging PHP-FPM Memory Exhaustion on WordPress with WooCommerce and Trellis

Over the past weekend, I spent considerable time debugging persistent memory exhaustion errors on a WordPress site running WooCommerce and the Roots stack (Trellis + Bedrock + Sage). What started as simple "critical error" messages turned into a deep investigation that uncovered **five distinct root causes**. This post documents the entire debugging journey, the tools used, and the solutions applied.

## The Symptoms

The site was experiencing intermittent failures with WordPress's generic error message:

```
There has been a critical error on this website.
```

PHP-FPM logs showed:

```
[pool wordpress] seems busy (you may need to increase pm.start_servers)
[pool wordpress] server reached pm.max_children setting (30)
```

Error logs revealed memory exhaustion:

```
PHP Fatal error: Allowed memory size of 536870912 bytes exhausted
```

The errors occurred roughly every 10 minutes, often triggered by simple requests like `HEAD /` from uptime monitors.

## The Investigation

### Step 1: Initial PHP-FPM Analysis

First, I checked the current worker state:

```bash
# Count active PHP-FPM workers
pgrep -c php-fpm

# Memory usage by PHP workers
ps aux --sort=-%mem | grep php-fpm | head -10

# Total PHP-FPM memory
ps aux | grep 'php-fpm: pool' | awk '{sum+=$6} END {print sum/1024" MB"}'
```

Workers were showing alarming memory usage:

```
817.754 MB - PID 56823
687.953 MB - PID 56841
177.629 MB - PID 56833
```

Some workers had ballooned to 800MB+ while others stayed healthy at ~150MB.

### Step 2: Understanding the Memory Math

On a 4GB server running the full LEMP stack:

```
Available RAM: ~3.5GB (after system/services)
30 workers × ~200MB each = 6GB theoretical max
Safe worker count: 3500MB / 200MB = ~17-18 workers
```

But the problem wasn't the worker count—it was **memory accumulation** in long-running workers.

## Root Cause #1: WordPress Memory Limit Too Low

The first discovery was surprising. WordPress has its **own internal memory limit** separate from PHP's limit:

```bash
# Check WordPress memory limits
wp eval 'echo "WP_MEMORY_LIMIT: " . WP_MEMORY_LIMIT . "\n";'
# Output: WP_MEMORY_LIMIT: 40M  ← WAY too low!
```

WordPress was capping itself at 40MB regardless of PHP's 512MB limit. With WooCommerce + Acorn (Laravel for WordPress), each request needs 150-250MB.

**The Fix:**

In `site/config/application.php` (Bedrock):

```php
/**
 * Memory Limits
 * WP_MEMORY_LIMIT: Memory for frontend requests (WordPress default: 40M)
 * WP_MAX_MEMORY_LIMIT: Memory for admin requests (WordPress default: 256M)
 */
Config::define('WP_MEMORY_LIMIT', '256M');
Config::define('WP_MAX_MEMORY_LIMIT', '512M');
```

## Root Cause #2: Worker Memory Accumulation

PHP-FPM workers don't release memory between requests. Over time, they accumulate:

```
Request 1:   150 MB
Request 50:  250 MB
Request 100: 350 MB
Request 200: 500+ MB  ← Danger zone!
```

The `pm.max_requests` setting forces workers to recycle after N requests. But on a low-traffic site (~80 requests/hour spread across 15 workers), workers were only handling ~5 requests/hour each. They'd accumulate memory for 20+ hours before recycling.

**The Fix:**

Reduce `pm.max_requests` aggressively:

```yaml
# trellis/group_vars/production/main.yml
php_fpm_pm_max_requests: 25  # Reduced from 500 → 200 → 100 → 25
```

Apply with:

```bash
trellis provision --tags wordpress-setup production
```

## Root Cause #3: Action Scheduler Async Runner

WooCommerce uses Action Scheduler for background tasks. I noticed the async runner was constantly spawning AJAX requests:

```
POST /wp-admin/admin-ajax.php?action=as_async_request_queue_runner
```

Each request tied up a PHP-FPM worker and accumulated ~2-5MB that was never released.

I had already added the constant to disable it:

```php
Config::define('ACTION_SCHEDULER_DISABLE_ASYNC', true);
```

But **WooCommerce 10.x ignores this constant!** It now uses a filter instead.

**The Fix:**

Create an MU-plugin that registers the filter before WooCommerce loads:

```php
<?php
/**
 * Plugin Name: Disable Action Scheduler Async Runner
 * Description: Disables WooCommerce Action Scheduler async AJAX runner.
 */

add_filter('action_scheduler_allow_async_request_runner', '__return_false');
```

Place in `site/web/app/mu-plugins/disable-action-scheduler-async.php`.

**Why MU-plugin?** MU-plugins load before regular plugins, ensuring the filter is registered before WooCommerce initializes.

## Root Cause #4: Orphaned Plugin Data

Database analysis revealed bloated data from plugins removed years ago:

```bash
# Check autoloaded options size
wp db query "SELECT option_name, LENGTH(option_value) as size_bytes
FROM wp_options WHERE autoload='yes'
ORDER BY size_bytes DESC LIMIT 10;"
```

Results:

| Option | Size | Source |
|--------|------|--------|
| rs-templates | 607 KB | Revolution Slider (removed 2019) |
| ptk_patterns | 512 KB | Starter Patterns (removed) |
| wp_installer_settings | 138 KB | WPML installer (from 2014!) |

**The Fix:**

```bash
# Delete orphaned options
wp db query "DELETE FROM wp_options WHERE option_name LIKE 'rs-%' OR option_name LIKE 'revslider%';"
wp db query "DELETE FROM wp_options WHERE option_name = 'ptk_patterns';"
wp db query "DELETE FROM wp_options WHERE option_name = 'wp_installer_settings';"

# Clean expired transients
wp transient delete --expired

# Flush object cache
wp cache flush
```

**Result:** 58.7% reduction in autoloaded data (608 KB → 251 KB).

## Root Cause #5: XMLRPC Attacks

The final piece of the puzzle came from Xdebug profiling. Error logs showed:

```
[23-Nov-2025 04:43:10] worker 77 exited on signal 9 (SIGKILL)
request: "POST /xmlrpc.php"
IP: 103.42.58.162
```

Even when xmlrpc.php returns 404/403, the request still:

1. Loads WordPress core (`wp-load.php`)
2. Bootstraps WooCommerce and Acorn
3. Executes `apply_filters()` chain
4. Consumes significant memory before being blocked

**The Fix:**

Block XMLRPC at the Nginx level (zero PHP involvement):

```yaml
# trellis/group_vars/production/wordpress_sites.yml
wordpress_sites:
  example.com:
    xmlrpc:
      enabled: false  # Generates: location ~* xmlrpc\.php$ { return 444; }
```

Trellis uses HTTP 444 (Nginx-specific "No Response") which drops the connection immediately. Attackers get a timeout with no feedback.

```bash
# Verify it's working
curl -v --max-time 5 https://example.com/xmlrpc.php
# Result: HTTP/2 stream was not closed cleanly: PROTOCOL_ERROR
```

## Diagnostic Commands Reference

Here are the key commands I used throughout this investigation:

### Memory Status

```bash
# Quick health check
ssh root@server "echo '=== Memory ===' && free -m | grep Mem && \
echo '' && echo '=== Workers ===' && \
ps aux --sort=-%mem | grep 'php-fpm: pool' | head -5 | \
awk '{print \$6/1024 \" MB - PID \" \$2}'"
```

### PHP-FPM Logs

```bash
# Recent warnings
grep 'seems busy\|max_children' /var/log/php8.3-fpm.log | tail -20

# Watch in real-time
tail -f /var/log/php8.3-fpm.log
```

### Database Analysis

```bash
# Autoloaded options size
wp db query "SELECT COUNT(*) as count, ROUND(SUM(LENGTH(option_value))/1024) as size_kb
FROM wp_options WHERE autoload='yes';"

# Largest options
wp db query "SELECT option_name, LENGTH(option_value) as size_bytes
FROM wp_options WHERE autoload='yes'
ORDER BY size_bytes DESC LIMIT 10;"
```

### Memory Spike Detection

```bash
# Watch for workers above 300MB
while true; do
  HIGH_MEM=$(ps aux --sort=-%mem | grep 'php-fpm: pool' | \
    awk '$6 > 307200 {print $6/1024 " MB - PID " $2}' | head -1)
  if [ -n "$HIGH_MEM" ]; then
    echo "[$(date +%H:%M:%S)] SPIKE: $HIGH_MEM"
    tail -3 /var/log/nginx/access.log
  fi
  sleep 10
done
```

## Final Configuration

After all fixes, here's the stable configuration:

```yaml
# PHP-FPM Pool (trellis/group_vars/production/main.yml)
php_fpm_pm: dynamic
php_fpm_pm_max_children: 30
php_fpm_pm_start_servers: 10
php_fpm_pm_min_spare_servers: 8
php_fpm_pm_max_spare_servers: 15
php_fpm_pm_max_requests: 25        # Aggressive recycling

# PHP Memory
php_memory_limit: 1024M            # High ceiling for headroom
```

```php
// WordPress Memory (site/config/application.php)
Config::define('WP_MEMORY_LIMIT', '256M');
Config::define('WP_MAX_MEMORY_LIMIT', '512M');
```

## Results

After implementing all fixes:

- **Workers stable at 112-120MB** (down from 600-800MB spikes)
- **No OOM errors** in 24+ hours
- **2.7GB free memory** on 4GB server
- **XMLRPC attacks blocked** at Nginx (zero PHP load)
- **Redis object cache active** (additional performance boost)

## Key Lessons Learned

1. **WordPress has its own memory limit** — `WP_MEMORY_LIMIT` caps memory regardless of PHP's `memory_limit`. Check this first on WooCommerce sites.

2. **Low-traffic sites need aggressive worker recycling** — `pm.max_requests: 500` is useless if workers only handle 5 requests/hour. Use 25-50 for low-traffic sites.

3. **Constants can become deprecated** — WooCommerce 10.x ignores `ACTION_SCHEDULER_DISABLE_ASYNC`. Always verify by checking actual code behavior.

4. **Block attacks at Nginx, not PHP** — Even "blocked" PHP requests consume memory during WordPress bootstrap. Use `return 444` for zero-PHP blocking.

5. **Old plugin data accumulates** — Plugins removed years ago can leave megabytes of orphaned data. Audit `wp_options` periodically.

6. **Profile production, not just development** — The XMLRPC attack pattern only appeared in production logs. Xdebug profiling on production (temporarily) was essential.

## Conclusion

What started as a simple "critical error" turned into a multi-day investigation uncovering five distinct issues. Each fix contributed to stability, but the **combination** of all fixes was necessary for complete resolution.

The most important takeaway: memory issues on WordPress/WooCommerce rarely have a single cause. Systematic investigation with proper tooling (logs, profiling, database analysis) is essential for finding all contributing factors.

If you're experiencing similar issues on your Trellis/Bedrock/Sage stack, I hope this detailed walkthrough helps you identify and fix your root causes faster than I did!

---

*Have you dealt with PHP-FPM memory issues on WordPress? Find me on Mastodon at [@jfrumau@mastodon.social](https://mastodon.social/@jfrumau) to share your experiences and solutions!*
