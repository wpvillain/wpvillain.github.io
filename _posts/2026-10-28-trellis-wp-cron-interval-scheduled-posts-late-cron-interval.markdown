---
layout: post
title: "Scheduled Posts Go Live Up to 15 Minutes Late on Trellis: WP-Cron Is Off, and the Interval Is a Site Setting"
date: 2026-10-28 16:00:00 +0700
categories: wordpress trellis wp-cli
tags: [wordpress, trellis, wp-cron, cron, ansible, multisite, scheduled-posts, devops]
case_category: devops
case_status: documented
---

On a Trellis site, a post scheduled for 09:00 can appear at 09:12. Nothing is broken. Trellis turns WP-Cron off and runs the due events from system cron instead, on a timer, and the timer is coarser than a page visit.

This is what Trellis actually sets up, how to check it, and how to change the interval without editing the role. I checked the details against a current Trellis checkout (October 2026), because several older write-ups, including my own notes, were out of date.

## What Trellis does

Two settings work together.

**WP-Cron is switched off for the site.** `disable_wp_cron` defaults to `true` for every environment (it sits in `group_vars/all/helpers.yml`), and it ends up as `DISABLE_WP_CRON` in the site's `.env`. With it off, visits no longer trigger scheduled tasks.

**A system cron job runs the due events instead.** The `wordpress-setup` role writes `/etc/cron.d/wordpress-<site>` with the dots in the site name turned into underscores:

```bash
#Ansible: example.com WordPress cron
*/15 * * * * web cd /srv/www/example.com/current && wp cron event run --due-now > /dev/null 2>&1
```

Every 15 minutes, as the web user, from the current release, running whatever is due and discarding the output. A post scheduled for 09:00 is published by the first run after 09:00.

### Multisite is different

On a multisite network the job is separate, and its file is named `wordpress-multisite-<site>`:

```bash
#Ansible: example.com WordPress network cron
*/30 * * * * web cd /srv/www/example.com/current && (wp site list --field=url | xargs -n1 -I % wp --url=% cron event run --due-now) > /dev/null 2>&1
```

It loops over every subsite, one after another, and the default interval is **30 minutes**, not 15. If you expected the single-site schedule on a network, that is your late posts.

## Check what is installed

```bash
ssh web@example.com "ls /etc/cron.d/ | grep wordpress; cat /etc/cron.d/wordpress-*"
ssh web@example.com "cd /srv/www/example.com/current && grep DISABLE_WP_CRON .env"
```

Look at the schedule in the file you find. The dated guides online show one value, but your install tells you the real one. To see what is waiting and when:

```bash
wp cron event list --fields=hook,next_run_relative --path=web/wp
```

And to run what is due right now, as the web user:

```bash
ssh web@example.com "cd /srv/www/example.com/current && wp cron event run --due-now"
```

## Change the interval: it is a site setting

You do not edit the Trellis role. Each site in `group_vars/<env>/wordpress_sites.yml` accepts its own interval:

```yaml
wordpress_sites:
  example.com:
    cron_interval: '*/5'            # single site, default '*/15'
```

For a multisite network the key has a different name:

```yaml
  example.com:
    multisite:
      enabled: true
    cron_interval_multisite: '*/10' # network, default '*/30'
```

Apply it by provisioning the role that writes the cron file:

```bash
cd trellis
trellis provision --tags wordpress-setup production
```

Then re-read `/etc/cron.d/` on the server to confirm it changed. Editing the cron file by hand also works until the next provision, which puts it back.

Pick the interval for the job it has to do. A short interval means the job starts more often, and cron does not stop a run from overlapping the one before it. On a multisite network with many subsites, one pass can take a while, so check how long a manual run takes before you go to every five minutes.

### Turn it off for a network

A network can opt out of the generated job with `multisite: { enabled: true, cron: false }` if you run cron some other way, for example from a monitoring service.

## Scheduled posts still not publishing

If a post sits at "Scheduled" long after its time, the interval is not the problem. Run the due events by hand and read the result:

```bash
sudo -u web bash -c "cd /srv/www/example.com/current && wp cron event run --due-now"
```

If that publishes it, the cron job is not running, so check `sudo systemctl status cron` and `sudo grep -i cron /var/log/syslog | tail`. If it does not, compare the server's clock with the site's timezone:

```bash
date
wp option get timezone_string --path=web/wp
```

## Direct wp-cron.php access

Some old plugins call `wp-cron.php` directly. Trellis does not allow that by default, and re-enabling it brings back the page-visit triggering that you switched off. If you must, the Nginx location block goes in the site template, and applying it needs the `wordpress-setup` role, not `--tags nginx`. See [the deny-list post]({% post_url 2026-10-28-fail2ban-wordpress-wp-login-trellis-nginx-deny-list %}) for why that tag does nothing for these files.
