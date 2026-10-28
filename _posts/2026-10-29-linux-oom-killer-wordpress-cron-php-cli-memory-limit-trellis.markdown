---
layout: post
title: "The OOM Killer Kept Killing php on a Trellis Server, and It Was Not PHP-FPM (Cron and the Unlimited PHP CLI Memory Limit)"
date: 2026-10-29 11:00:00 +0700
categories: wordpress trellis php
tags: [wordpress, trellis, php, oom, wp-cron, action-scheduler, woocommerce, journalctl, devops]
case_category: devops
case_status: documented
---

A 4GB WordPress and WooCommerce server on Trellis was having processes killed. The reflex is to blame PHP-FPM, because that is where the memory usually goes. Here it was not PHP-FPM at all, and the kernel log said so plainly once I looked in the right boot.

## Look at the previous boot

After an OOM kill the server often reboots or gets restarted, and the current boot's log is clean. That is how you end up concluding that nothing happened. Ask for the kernel log of the boot before:

```bash
ssh root@example.com 'journalctl -k -b -1 | grep -Ei "oom|killed process|out of memory"'
```

`-b -1` is the previous boot and `-b -2` the one before that. `journalctl --list-boots` shows what you have. If the journal is not persistent you only get the current boot, which is worth knowing before you rely on this.

## Read the kill line

Two events, about 30 minutes apart, looked like this (trimmed):

```
systemd invoked oom-killer: ... global_oom,task_memcg=/system.slice/cron.service,task=php,pid=70787,uid=1000
Out of memory: Killed process 70787 (php) total-vm:3621976kB, anon-rss:3235148kB ...
```

Three fields tell the story:

- `task=php`, not `php-fpm: pool wordpress`. A standalone PHP process, not a FPM worker.
- `uid=1000`, the deploy user, not `www-data`.
- `task_memcg=/system.slice/cron.service`. Something cron started.

The victim held 3.08GB and 2.40GB of resident memory. On a 4GB machine one such process is the whole server.

## Rule out PHP-FPM

Check the workers on the running system:

```bash
ssh root@example.com "ps aux --sort=-%mem | grep 'php-fpm: pool' | head -5 | awk '{print \$6/1024 \" MB - PID \" \$2}'"
```

About 120 to 130MB each is healthy. The service's memory peak from the old boot is worth a look too:

```bash
ssh root@example.com "journalctl --since '2025-11-25 00:00:00' --until '2025-11-25 23:59:59' | grep -i 'memory peak'"
```

`php8.3-fpm.service` showing a 2.8G peak sounds alarming, but that is the sum over all workers on a busy site. The 3GB kill was one process.

## Find what cron runs

```bash
ssh root@example.com 'ls -lah /etc/cron* /var/spool/cron/crontabs'
```

In `/etc/cron.d/` there were files per site, like `wordpress-example_com`. Trellis sets `DISABLE_WP_CRON` and replaces WordPress's request-triggered cron with a system cron entry every 15 minutes that calls `wp-cron.php`. (If you want to change that interval, see [the WP-Cron interval post]({% post_url 2026-10-28-trellis-wp-cron-interval-scheduled-posts-late-cron-interval %}).)

Whatever that run executes is a PHP process under cron, and it takes its settings from the **CLI** `php.ini`, not from the FPM pool.

## The unlimited memory limit

```bash
ssh root@example.com "php -i | grep memory_limit"
```

```
memory_limit => -1 => -1
```

Trellis has a `php_cli_memory_limit` variable, and its default is `-1`, unlimited. A heavy scheduled task in a CLI process then grows until the kernel steps in. FPM has pool limits and WordPress has `WP_MEMORY_LIMIT`, so nothing stopped this one.

Set it in `trellis/group_vars/production/main.yml`:

```yaml
php_cli_memory_limit: 512M
```

Then re-provision the PHP role (`trellis provision --tags php production`), or edit the file by hand. The manual equivalent is `memory_limit = 512M` in `/etc/php/8.3/cli/php.ini`.

This does not fix the task that wants 3GB. It turns an OOM kill of an arbitrary process into a PHP fatal error with a name attached, in the log, for one job. That is a much better failure.

## Find the heavy job

List the scheduled events:

```bash
ssh web@example.com "cd /srv/www/example.com/current && wp cron event list --path=web/wp"
```

On this site the usual suspects were there: `action_scheduler_run_queue` every minute (WooCommerce background work), a cache plugin's list updates, and several `wc_admin_*` hooks. Action Scheduler is the first place to look, for stuck and failed jobs:

```bash
ssh web@example.com "cd /srv/www/example.com/current && wp db query 'SELECT action_id, hook, status, scheduled_date_gmt, attempts FROM wp_actionscheduler_actions WHERE status = \"failed\" ORDER BY scheduled_date_gmt DESC LIMIT 50;' --path=web/wp"
```

A previous attempt on this server was a must-use plugin that disabled Action Scheduler's async runner (`add_filter('action_scheduler_allow_async_request_runner', '__return_false');`) to stop FPM workers growing. It did not cure the pool exhaustion it was meant for, and by moving the work into cron it may have helped cause this problem. If you have changed how Action Scheduler runs, remember it when you read a log like this one.

Also useful: `wp db check` after OOM kills, to confirm that no table was left damaged. All 163 tables on this site passed.

## Watch it

Log what cron spawns, to correlate with the kill times:

```bash
*/5 * * * * root ps aux | grep -E "php.*cron" >> /var/log/php-cron-monitor.log
```

And check the kernel log daily until you trust the fix:

```bash
ssh root@example.com 'journalctl -k --since "24 hours ago" | grep -Ei "oom|killed process"'
```

## What I would check first next time

1. `journalctl -k -b -1` before anything else, because the current boot lies.
2. The process name and `task_memcg` in the kill line: FPM, cron or something else entirely.
3. `php -i | grep memory_limit` for the CLI.
4. Only then tuning FPM. If the pool really is the problem, the [PHP-FPM memory exhaustion post]({% post_url 2025-11-24-debugging-php-fpm-memory-exhaustion-wordpress-woocommerce-trellis %}) covers the worker maths.
