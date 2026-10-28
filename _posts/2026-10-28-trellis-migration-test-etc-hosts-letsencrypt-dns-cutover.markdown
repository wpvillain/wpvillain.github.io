---
layout: post
title: "Testing a Trellis Migration Before DNS: /etc/hosts, a Self-Signed Certificate, and the Let's Encrypt Cutover"
date: 2026-10-28 22:30:00 +0700
categories: wordpress trellis devops
tags: [wordpress, trellis, migration, dns, letsencrypt, ssl, nginx, cron]
case_category: devops
case_status: documented
---

The site is deployed on the new Trellis server, the database and uploads are in. You still cannot look at it with the real domain, because DNS points at the old host. Flipping DNS to find out whether it works is the wrong test: every visitor is the test.

This is how I get a real look at the site on the new server first, and the order of the cutover after that. It continues [the migration steps]({% post_url 2026-10-28-migrate-wordpress-to-trellis-bedrock-step-by-step %}).

## Point your own machine at the new server

Your `/etc/hosts` file overrides DNS for your machine only. Add the new server's IP for the production domain:

```text
203.0.113.10  example.com
203.0.113.10  www.example.com
```

Edit it with `sudo nano /etc/hosts` on macOS or Linux, or `C:\Windows\System32\drivers\etc\hosts` as administrator on Windows. Flush the DNS cache so the change is picked up:

```bash
# macOS
sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder

# Linux
sudo systemd-resolve --flush-caches
```

```cmd
:: Windows
ipconfig /flushdns
```

Now `https://example.com` in your browser reaches the new server. Everyone else still gets the old one. You can remove the line to compare the two sides at any time.

## The certificate problem

Let's Encrypt validates that the domain points at the server asking for the certificate. Before DNS changes, it cannot issue one. So the new server has no valid certificate yet, and you have two options.

**Test over HTTP.** Set `ssl.enabled: false` for the site in `group_vars/production/wordpress_sites.yml`, apply it, and browse to `http://example.com`:

```bash
trellis provision production --tags nginx
```

It is simple, and it will not show you mixed-content or HTTPS redirect problems.

**Use a self-signed certificate.** Keep SSL on and give Nginx a temporary certificate on the server:

```bash
sudo mkdir -p /etc/nginx/ssl/example.com
sudo openssl req -x509 -nodes -days 30 -newkey rsa:2048 \
  -keyout /etc/nginx/ssl/example.com/server.key \
  -out /etc/nginx/ssl/example.com/server.crt \
  -subj "/CN=example.com"
```

Point the site's `ssl_certificate` and `ssl_certificate_key` at those files, then `sudo systemctl reload nginx`. The browser warns once and you accept it. This is closer to production, which is why I prefer it. Remember it is a hand edit on the server, so the next provision overwrites it.

## What to test

With the real domain in front of you:

- The home page, a few posts, the search, archives, and any custom post types.
- Forms, logins, checkout if there is one.
- The browser console for 404s, JavaScript errors and mixed content.
- Images at several sizes, and an upload through the admin.
- `sudo tail -f /var/log/nginx/error.log` on the server while you click around.

When something breaks, the usual fixes are another search-replace for a missed URL variant, re-checking the uploads path and ownership, and flushing caches (`wp cache flush && wp rewrite flush`).

## Before you switch DNS

1. Turn SSL back on for the site and set the provider to Let's Encrypt in `wordpress_sites.yml`, and commit it:

```yaml
wordpress_sites:
  example.com:
    site_hosts:
      - canonical: example.com
        redirects:
          - www.example.com
    ssl:
      enabled: true
      provider: letsencrypt
```

2. Remove the `/etc/hosts` lines and flush the cache again, so you are testing what visitors will see.
3. **Lower the DNS TTL** on the current records 24 hours before the cutover. A TTL of 300 means most resolvers pick up the change within five minutes instead of an hour or more.

## The cutover

1. Change the A record for the domain (and `www`) to the new server's IP.
2. Watch it propagate:

```bash
dig example.com +short    # should return the new IP
```

   `whatsmydns.net` shows the answer from resolvers around the world.
3. Once DNS answers with the new IP, request the certificate. Only the SSL tasks run:

```bash
trellis provision production --tags letsencrypt
```

4. Confirm it:

```bash
ssh admin@your.server.ip
sudo certbot certificates
curl -I https://example.com | head -1
```

Keep the old hosting running for a few days. Anyone whose resolver still has the old record lands there, and a 301 redirect to the new host in its `.htaccess` sends them on.

## WP-Cron changes after the move

A change that surprises people after a migration: Trellis turns WP-Cron off and runs due events from system cron instead.

| | Shared hosting | Trellis |
|---|---|---|
| How events run | When someone visits the site | `wp cron event run --due-now` from `/etc/cron.d/wordpress-example_com` |
| Low traffic | Events run late | Events run on the timer |
| Interval | Per visit | 15 minutes on a single site |

Your scheduled events are in the database and carry over. Check that they did:

```bash
cd /srv/www/example.com/current && grep DISABLE_WP_CRON .env   # DISABLE_WP_CRON=true
cat /etc/cron.d/wordpress-example_com
wp cron event list
```

If scheduled posts now go live up to 15 minutes late, that is the interval. [This post]({% post_url 2026-10-28-trellis-wp-cron-interval-scheduled-posts-late-cron-interval %}) covers the multisite case and how to change it.

## After launch

- Back up the database and uploads on a schedule, not once.
- Turn on object caching if the site benefits from it, and check page timing.
- Add fail2ban for `wp-login.php` ([how I do it]({% post_url 2026-10-28-fail2ban-wordpress-wp-login-trellis-nginx-deny-list %})).
- Disable file editing in the admin: `define('DISALLOW_FILE_EDIT', true);` in `config/application.php`.

---

*Did the cutover go differently for you, or do you test migrations another way? Find me on Mastodon at [@jfrumau@mastodon.social](https://mastodon.social/@jfrumau).*
