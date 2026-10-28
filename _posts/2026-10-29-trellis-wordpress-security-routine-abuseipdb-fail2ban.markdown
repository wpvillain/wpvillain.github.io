---
layout: post
title: "A Weekly and Monthly Security Routine for Trellis WordPress Sites: fail2ban, Scans, and Checking IPs Against AbuseIPDB Before You Block Them"
date: 2026-10-29 12:30:00 +0700
categories: wordpress trellis security
tags: [wordpress, trellis, security, fail2ban, abuseipdb, nginx, wp-cli, monitoring]
case_category: security
case_status: documented
---

Security on a Trellis site comes in layers, and each layer needs a little attention on a schedule. None of it takes long. What goes wrong is that nobody checks, so the first time you read the fail2ban log is during an incident.

This is the routine I run: what each layer does, what to check weekly and monthly, how to use AbuseIPDB so you do not block a search crawler by mistake, and the fixes for the usual problems.

## The layers

1. **Firewall (UFW).** fail2ban bans addresses here.
2. **Nginx.** A deny list for permanent blocks ([the post on deny lists]({% post_url 2026-10-29-nginx-deny-list-trellis-cidr-whitelist-self-lockout %})).
3. **WordPress.** Plugins and settings.
4. **Application code.** The malware scanners ([scanners]({% post_url 2026-10-29-wordpress-malware-scanners-targeted-general-checksum-verification %}) and [reading the results]({% post_url 2026-10-29-reading-malware-scan-results-false-positives-wordpress-hardening %})).

For most sites: fail2ban is the main defence, weekly scans are the monitoring, and a manual Nginx block is the exception.

## A note on which SSH user

Trellis creates admin users in `group_vars/<env>/users.yml`. They have `sudo`, which asks for a password. Commands below use `admin_user` for yours.

For read-only work, such as reading logs, use the **`web`** user instead. It has no sudo and can read the site and its logs, so there is less to go wrong. Use `admin_user` only for `fail2ban-client` and anything under `/var/log`.

## Turn fail2ban on

In `trellis/group_vars/all/security.yml`:

```yaml
fail2ban_services_custom:
  - name: wordpress_wp_login
    enabled: "true"
```

then apply it. The jail definition, the filter and how to check it work are in [the fail2ban post]({% post_url 2026-10-28-fail2ban-wordpress-wp-login-trellis-nginx-deny-list %}).

## Weekly

```bash
# 1. The targeted scanner, 1 to 2 seconds
wp eval-file wp-cli/security/scanner-targeted.php

# 2. Is the jail alive, and who is banned?
ssh admin_user@yoursite.com
sudo fail2ban-client status wordpress_wp_login
sudo fail2ban-client get wordpress_wp_login banip
```

## Monthly

```bash
# 1. Deep scan, 2 to 3 seconds
wp eval-file wp-cli/security/scanner-general.php

# 2. Recent bans
ssh admin_user@yoursite.com "sudo grep 'Ban ' /var/log/fail2ban.log | tail -20"

# 3. The heaviest login attackers, as the web user (no sudo)
ssh web@yoursite.com "grep 'POST.*wp-login' /srv/www/yoursite.com/logs/access.log | awk '{print \$1}' | sort | uniq -c | sort -rn | head -20"

# 4. Updates
wp core update
wp plugin update --all
```

Updating is the most useful security step on the list. Run it in development first.

## Is this IP really bad? AbuseIPDB

Before an address goes on a permanent list, check it. `check-ips.sh` looks addresses up in [AbuseIPDB](https://www.abuseipdb.com/), which keeps community reports with a confidence score.

Get a free key (1,000 checks a day), put it in `trellis/security/.env`, and make sure `jq` and `curl` are installed:

```bash
echo 'ABUSEIPDB_KEY=your_key_here' > trellis/security/.env
brew install jq curl

./trellis/security/check-ips.sh 203.0.113.50 198.51.100.25
# or
wp-ops check-ips 203.0.113.50
```

The output is JSON per address:

```json
{
  "score": 92,
  "reports": 187,
  "lastSeen": "2026-07-30T14:22:11+00:00",
  "country": "CN",
  "isp": "Example ISP",
  "usageType": "Data Center/Web Hosting/Transit",
  "tor": false
}
```

A high `score` (0 to 100) with many, recent `reports` supports a block. A score of 0 and no reports is a strong sign the address is **not** malicious: a shared NAT gateway, a crawler or a monitoring service. Do not block it.

### Audit the deny list

Lists rot. An address that attacked you two years ago may now belong to someone else. `check-deny-ips.sh` checks every individual address already in your `deny-ips.conf.j2` and shows the score, report count and last report, so stale entries are easy to see. CIDR ranges are skipped, since AbuseIPDB looks up single addresses, and are reported as a count.

```bash
TRELLIS_DIR=/path/to/trellis ./trellis/security/check-deny-ips.sh
TRELLIS_DIR=/path/to/trellis ./trellis/security/check-deny-ips.sh --full   # JSON per address
TRELLIS_DIR=/path/to/trellis wp-ops check-deny-ips
```

## After a suspected compromise

```bash
wp eval-file wp-cli/security/scanner-wrapper.php     # both scanners
wp user list --role=administrator
wp core verify-checksums
wp plugin verify-checksums --all
ssh web@yoursite.com "find /srv/www/yoursite.com/current/web/wp-content -mtime -7 -type f"
```

The reasoning for each step is in [the post on reading results]({% post_url 2026-10-29-reading-malware-scan-results-false-positives-wordpress-hardening %}).

## Problems

**I locked myself out (403).**

- If fail2ban banned you: `ssh admin_user@yoursite.com "sudo fail2ban-client set wordpress_wp_login unbanip YOUR.IP.HERE"`, then add your address to `ip_whitelist` in `security.yml`.
- If an Nginx deny rule blocked you: use the VPS web console, comment your address out of `/etc/nginx/includes.d/all/deny-ips.conf`, and reload Nginx.

**An attacker is not being banned.**

1. The jail is not enabled. `sudo fail2ban-client status` should list `wordpress_wp_login`.
2. They have not reached the threshold. The default is 6 failed attempts. Check with `sudo grep 'Found.*wp-login' /var/log/fail2ban.log | grep 'ATTACKER.IP'`.
3. They rotate addresses, so each new one needs 6 attempts. That is the case for a manual block or a range.
4. fail2ban is not reading the right log: `sudo fail2ban-client get wordpress_wp_login logpath`.

**fail2ban will not start.**

```bash
sudo systemctl status fail2ban
sudo journalctl -u fail2ban -n 50
sudo fail2ban-client -d        # dump the parsed configuration
sudo systemctl restart fail2ban
```

## Habits that hold up

- Layer the defences. Do not rely on a plugin that an attacker's request never reaches.
- Keep the security files in version control: `security.yml` and the deny list are part of the server's behaviour.
- Test an Nginx change before deploying it: `sudo nginx -t`, then `trellis provision --tags nginx-includes`.
- Write down why each block exists.

---

*Run security checks on a schedule differently? Find me on Mastodon at [@jfrumau@mastodon.social](https://mastodon.social/@jfrumau).*
