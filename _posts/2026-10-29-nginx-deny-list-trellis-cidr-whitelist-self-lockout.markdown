---
layout: post
title: "A Permanent Nginx Deny List on Trellis: When It Beats fail2ban, CIDR Ranges, and How Not to Lock Yourself Out"
date: 2026-10-29 12:00:00 +0700
categories: wordpress trellis security
tags: [wordpress, trellis, nginx, security, deny-list, fail2ban, cidr, devops]
case_category: security
case_status: documented
---

[fail2ban]({% post_url 2026-10-28-fail2ban-wordpress-wp-login-trellis-nginx-deny-list %}) is the right default: it detects an attacker, bans the address for a while, and needs no upkeep. Its weakness is that a ban expires and a rotating attacker never trips it. For those cases there is the blunt tool, a list of `deny` lines in Nginx that blocks an address permanently, early in request handling, for any URL.

That post introduces the deny list. This one covers what it leaves out: when to use it, ranges, the allow-before-deny rule that keeps you from locking yourself out, how to see what it is blocking, and what to do when something goes wrong.

## fail2ban or a manual block

| Situation | fail2ban | Manual block |
|---|---|---|
| Brute force on `wp-login.php` | yes | not needed |
| XML-RPC abuse | yes | not needed |
| One address sending 1,000+ requests a minute | may not react fast enough | yes |
| Many addresses, each below the threshold | catches them individually | too many to manage |
| A persistent attacker who returns after the ban expires | rebans | yes, to make it permanent |
| Attacks on URLs that are not WordPress | cannot see them | yes |

**Manual blocks**: permanent, survive reboots, cheap for Nginx to process, work for any URL, and live in your Trellis repository. They also need maintenance, can block you or a legitimate shared address, and attackers rotate addresses anyway.

**fail2ban**: automatic, temporary bans avoid false positives, and it is already in Trellis.

Use fail2ban as the default and add a manual block only for the extreme cases above. Before adding any address, check that it is actually malicious. It is easy to mistake a search crawler or an uptime monitor for an attacker, particularly in a distributed pattern (the reputation check is in [the security routine post]({% post_url 2026-10-29-trellis-wordpress-security-routine-abuseipdb-fail2ban %})).

## The file

Create `trellis/nginx-includes/all/deny-ips.conf.j2`. The `all/` directory means it applies to every site on the server:

```nginx
# Nginx IP deny list for WordPress security
# Managed via: trellis/nginx-includes/all/deny-ips.conf.j2
# Apply changes: cd trellis && trellis provision --tags nginx-includes production
#
# Verify addresses before adding: whois <IP>

deny 62.60.130.228;   # wp-login brute force, 1,420 attempts
deny 141.98.11.120;   # same campaign
```

It is a `.j2` template so Trellis can render it, which also lets you stamp it with a deployment date or hostname if you want to know which version is live.

Deploy only the includes:

```bash
cd trellis
trellis provision --tags nginx-includes production
```

Check it reached the server and parses:

```bash
ssh admin_user@yoursite.com "sudo nginx -t"
ssh admin_user@yoursite.com "cat /etc/nginx/includes.d/all/deny-ips.conf"
```

Test a change in the development VM before production. A syntax error in this file makes Nginx refuse to reload.

## Adding and removing addresses

Look the address up first:

```bash
whois 62.60.130.228
```

A common way to build a list is to take the heaviest login attackers out of the access log:

```bash
ssh web@yoursite.com "grep 'POST.*wp-login' /srv/www/yoursite.com/logs/access.log | awk '{print \$1}' | sort | uniq -c | sort -rn | head -20"
```

Always comment why an address is there. `deny 1.2.3.4;` with no note is unreviewable in six months; `deny 1.2.3.4;  # wp-login brute force, 1,420 attempts` is not. To remove one, comment the line out with a reason rather than deleting it, so the history reads:

```nginx
# deny 1.2.3.4;  # Removed: reason for unblocking
```

## Ranges

CIDR notation blocks a whole network:

```nginx
deny 192.168.1.0/24;   # 192.168.1.0 to 192.168.1.255
```

Be sure before you do. Blocking a cloud provider's range (AWS, DigitalOcean) also blocks the legitimate visitors, monitors and bots that come from it.

The opposite, `allow` lines followed by `deny all;`, blocks everyone except the listed addresses. That is a maintenance-mode or staging setup, not a way to protect a live site.

## Not locking yourself out

Order matters in Nginx: `allow` and `deny` are checked in order and the first match wins. So the allowlist goes first:

```nginx
# Never blocked (must come before any deny)
allow 1.2.213.123;     # my IP
allow 203.0.113.0/24;  # office network

# Blocked
deny 62.60.130.228;
deny 141.98.11.120;
```

Check your own address before you edit the list:

```bash
curl https://ipinfo.io/ip
```

If you are locked out anyway, SSH might still work, because `deny` here applies to web requests and not to the SSH port. Otherwise use your VPS provider's web console:

```bash
sudo nano /etc/nginx/includes.d/all/deny-ips.conf
# comment out your address, or delete the file
sudo systemctl reload nginx
```

A fail2ban lockout is a different fix: unban your address and add it to the `ip_whitelist` in `security.yml`.

## What it is blocking

Nginx logs every denied request:

```bash
ssh admin_user@yoursite.com "sudo grep 'access forbidden' /var/log/nginx/error.log | tail -20"
```

```text
[error] ... access forbidden by rule, client: 62.60.130.228, server: example.com, request: "POST /wp-login.php HTTP/1.1"
```

Count requests per address to see whether the list is doing anything:

```bash
ssh admin_user@yoursite.com "sudo grep 'access forbidden' /var/log/nginx/error.log | awk '{print \$13}' | sort | uniq -c | sort -rn"
```

```text
    847 62.60.130.228,
    592 141.98.11.120,
    301 91.224.92.114,
```

Addresses that appear here have been refused hundreds of times. Addresses that never appear can probably come off the list.

## When it does not work

**Nginx will not reload.** It is almost always a typo. `nginx -t` names it. The usual ones are a missing semicolon (`deny 1.2.3.4`), or an impossible address (`deny 1.2.3.256;`).

**A legitimate visitor gets a 403.** Ask them for their address (`https://ipinfo.io/ip`) and grep for it:

```bash
ssh admin_user@yoursite.com "grep '5.6.7.8' /etc/nginx/includes.d/all/deny-ips.conf"
```

If it is there, remove it from the template and provision the `nginx-includes` tag again. Shared addresses (offices, VPNs, mobile carriers) are where this happens.

**The attacker is still getting in.**

- Check the deployed file has the address: `grep '62.60.130.228' /etc/nginx/includes.d/all/deny-ips.conf`.
- If it is not there, you did not provision the tag, or the template is in `nginx-includes/` rather than `nginx-includes/all/`.
- If it is there, the attacker is using another address, or arriving through a proxy or CDN. In that case the connecting address is the proxy's, and you need to look at the forwarded-for header.

## Housekeeping

- Review the list on a schedule and prune addresses that never show up in the error log.
- Back up the current file before a big edit.
- Keep the file in version control. It is part of your server's behaviour.

---

*Run a deny list differently, for example at the firewall? Find me on Mastodon at [@jfrumau@mastodon.social](https://mastodon.social/@jfrumau).*
