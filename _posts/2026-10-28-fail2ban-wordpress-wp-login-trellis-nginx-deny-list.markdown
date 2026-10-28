---
layout: post
title: "fail2ban for wp-login.php on Trellis: Turn the Jail On, Anchor the Filter, Keep an Nginx Deny List for the Rest"
date: 2026-10-28 11:00:00 +0700
categories: wordpress security trellis
tags: [wordpress, trellis, fail2ban, nginx, security, brute-force, ansible, hetzner]
case_category: security
case_status: shipped
---

One IP address tried to log in to `/wp-login.php` 1,420 times in two months on a production Trellis server. Two more tried 860 and 742 times, and over 40 other addresses joined in. None got in. Every attempt still ran PHP and hit the database, and one weak password would have been enough.

Trellis installs fail2ban and protects SSH out of the box. The WordPress jails ship **disabled**. This is how I turned the login jail on, the filter bug that banned me, and what I use when fail2ban is not the right tool.

## Enable the jail

The jails live in `trellis/group_vars/all/security.yml`:

```yaml
fail2ban_bantime: 900        # 15 minutes
fail2ban_maxretry: 3         # global default, used by the sshd jail
fail2ban_findtime: 600       # window the failures are counted in

fail2ban_services_custom:
  - name: wordpress_wp_login
    filter: wordpress-wp-login
    enabled: "true"
    port: http,https
    logpath: "{{ www_root }}/**/logs/access.log"
    maxretry: 6                # more forgiving for real users than sshd
```

A per-jail `maxretry` overrides the global one, so SSH stays strict while the login page tolerates a few typos. Apply only the fail2ban role:

```bash
cd trellis
trellis provision --tags fail2ban production
```

Re-run it after any change to `security.yml`. The first attacker was banned within seven hours.

Skip the `wordpress_xmlrpc` jail if Nginx already refuses XML-RPC. Run `curl -I https://example.com/xmlrpc.php`: a 403 or an empty 444 means there is nothing left for that jail to catch.

## The filter that banned me

My first filter matched `wp-login.php` anywhere in the log line. That includes the referrer field, so a logged-in user clicking around right after logging in collected "failures" from the page they came from. I work from changing locations and VPN exits, and I got banned while using the site.

A failed login returns `200` (the form is shown again). A successful one redirects with `302`. So match a POST to `wp-login.php` that returned 200, anchored to the quoted request field:

```ini
# filter.d/wordpress-wp-login.conf
[Definition]
failregex = ^<HOST> .* "POST [^"]*wp-login\.php[^"]*" 200
```

Test any filter against a real log before you trust it. Look for a non-zero `matched` count:

```bash
sudo fail2ban-regex /srv/www/example.com/logs/access.log \
  /etc/fail2ban/filter.d/wordpress-wp-login.conf
```

Keep an exemption list as a safety valve. `ip_whitelist` feeds fail2ban's `ignoreip`:

```yaml
ip_whitelist:
  - 127.0.0.0/8
  - "{{ ipify_public_ip | default('') }}"   # the machine you provision from
  - 203.0.113.0/24                           # office network
```

I still exempt a VPN range, because one ban landed during a two-factor reset. An exemption list does not replace a correct filter.

## Check it, ban, unban

The admin user's sudo asks for a password, so use `ssh -t`:

```bash
ssh -t admin@example.com "sudo fail2ban-client status wordpress_wp_login"
ssh -t admin@example.com "sudo grep 'Ban ' /var/log/fail2ban.log | tail -20"
```

```bash
sudo fail2ban-client set wordpress_wp_login banip 1.2.3.4
sudo fail2ban-client set wordpress_wp_login unbanip 1.2.3.4
```

If you lock yourself out, unban from another connection (phone hotspot, VPN). Failing that, use the provider's server console: `sudo systemctl stop fail2ban`, log in, add your address to `ip_whitelist`, re-provision, then start fail2ban again.

## When fail2ban is not enough: a permanent Nginx deny list

fail2ban bans temporarily and reads the log after the fact. For a known persistent attacker, or a flood too fast for it, or abuse on a URL the filter does not know about, block at Nginx. Create `trellis/nginx-includes/all/deny-ips.conf.j2`:

```nginx
# Managed via trellis/nginx-includes/all/deny-ips.conf.j2
# Last updated: {{ ansible_date_time.date }}
# Apply: trellis provision --tags nginx production

deny 62.60.130.228;   # 1,420 wp-login attempts
deny 141.98.11.120;   # 860 wp-login attempts
deny 91.224.92.114;   # 742 wp-login attempts
```

Apply it with `trellis provision --tags nginx production`. It lives in Git, survives reboots and is checked early in request handling. The costs are manual upkeep, the risk of blocking yourself, and attackers rotating addresses anyway. Research an address with `whois` before you add it.

Dry-run first:

```bash
ansible-playbook server.yml -e env=production --tags nginx --check
```

### Testing a deny rule

You cannot test it by spoofing `X-Forwarded-For`. Nginx's `deny` matches the connection's real address (`$remote_addr`), so the header does nothing unless you have configured real-IP handling for a proxy in front. Two checks that do work:

```bash
# is the rule in the live config?
ssh -t admin@example.com "sudo nginx -T 2>/dev/null | grep -n 'deny 62.60.130.228'"

# does the config parse?
ssh -t admin@example.com "sudo nginx -t"
```

For an end-to-end test, add your own address to the list on staging, confirm you get `403 Forbidden`, and remove it again.

## Which one to use

| Situation | fail2ban | Nginx deny list |
| --- | --- | --- |
| Brute-force `wp-login.php` attempts | yes | not needed |
| XML-RPC abuse | yes | not needed |
| Many different addresses | catches each one | too many to manage |
| Known persistent attacker | rebans automatically | permanent block |
| Attack on non-WordPress URLs | cannot see it | yes |

Use fail2ban first. It needs no maintenance and short bans keep false positives cheap. Reach for the deny list only for the few addresses that keep coming back.

fail2ban needs control of the server's firewall, so it is not an option on shared hosting.
