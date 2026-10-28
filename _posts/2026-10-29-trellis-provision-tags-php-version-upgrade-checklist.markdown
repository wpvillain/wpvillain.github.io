---
layout: post
title: "Trellis Provision Tags Cheat Sheet, and the PHP Upgrade That Breaks Deploys If You Skip the users Tag"
date: 2026-10-29 10:30:00 +0700
categories: wordpress trellis ansible
tags: [wordpress, trellis, ansible, php, php-fpm, sudoers, provision, devops]
case_category: devops
case_status: documented
---

`trellis provision production` runs every role on the server. It is the right command after a big change and the wrong one for a small one: it takes a long time, touches everything and is more to go wrong. Most of the time you want a tag.

These are the commands I use after the machine and project are set up, and the one tag list that is easy to get wrong: upgrading PHP.

## Everyday commands

```bash
cd trellis

# Local VM
trellis provision development

# Deploy (this is an application deploy, not provisioning)
trellis deploy staging
trellis deploy production
trellis deploy production example.com        # one site

# Re-provision only part of the server
trellis provision --tags php,nginx,composer production

# Everything, sparingly
trellis provision production
```

`trellis provision` is the CLI wrapper around the `server.yml` playbook. It adds the vault password handling and the project's Python environment, which is why it is better than calling `ansible-playbook server.yml -e env=production` yourself. Deploys also work as `ansible-playbook deploy.yml -e env=production`.

## Tags I reach for

| Situation | Command |
|---|---|
| Changed or added an Nginx include | `trellis provision --tags nginx-includes production` |
| Need a Let's Encrypt certificate after a DNS change | `trellis provision production --tags letsencrypt` |
| Changed Nginx config | `trellis provision --tags nginx production` |
| Added a site to `wordpress_sites.yml` | `trellis provision production`, then deploy that site |
| Upgrading PHP | the list below |

Tags are quick, but they only run the tasks that carry that tag. If a change touches something a tag does not cover, you will not see it applied. When a tagged run "succeeds" and nothing changed, that is the first thing to suspect.

## Upgrading PHP

Change `php_version` in `trellis/group_vars/all/main.yml`, then:

```bash
trellis provision --tags php,nginx,wordpress-setup,users,memcached production
```

Each tag has a reason:

| Tag | Why |
|---|---|
| `php` | Installs the new PHP version and its extensions |
| `nginx` | Points Nginx at the new PHP-FPM socket |
| `wordpress-setup` | Creates the PHP-version-specific pool file, for example `/etc/php/8.3/fpm/pool.d/wordpress.conf` |
| `users` | Regenerates the sudoers rule that lets the deploy user reload PHP-FPM without a password |
| `memcached` | Installs the version-specific memcached extension, for example `php8.3-memcached` |

**Leave out `users` and deploys fail.** The sudoers entry still names the old PHP version, so when the deploy tries to reload PHP-FPM it asks for a password it cannot give. The server is fine and the site is up, and every deploy breaks until you run the `users` tag. It is the tag people drop because it sounds unrelated.

Run the same upgrade on staging first. A PHP version change is also a good time to check your plugins on the new version locally, in the development VM, before any server sees it.

## WP-Cron

Trellis turns WP-Cron off and runs due events from system cron, which also explains scheduled posts going live up to a quarter of an hour late. [This post]({% post_url 2026-10-28-trellis-wp-cron-interval-scheduled-posts-late-cron-interval %}) covers what the cron job looks like, how to check it and how to change the interval.

---

*Have a tag list you rely on that I missed? Find me on Mastodon at [@jfrumau@mastodon.social](https://mastodon.social/@jfrumau).*
