---
layout: post
title: "Upgrading a Live Trellis Server to 1.33: msmtp, HTTP/3, the MariaDB 11.8 Trap, and the apt Upgrade Provisioning Doesn't Do"
date: 2026-11-08 10:30:00 +0700
categories: wordpress trellis ansible
tags: [wordpress, trellis, ansible, ubuntu, mariadb, nginx, http3, msmtp, devops, upgrade]
case_category: devops
case_status: shipped
---

trellis-cli 1.20.0 came out on November 3 and makes Ubuntu 26.04 the default for new VMs and `trellis server create`. The first question was whether that meant upgrading our production server, which runs four sites: three WordPress sites and a Laravel app. It didn't. Here is what it did mean, and what came up while upgrading Trellis itself from 1.28 to 1.33 on that server.

## The 26.04 default needs Trellis 1.33

The release notes say it plainly: Ubuntu 26.04 requires Trellis v1.33.0 or later. Our server ran Ubuntu 24.04.4 LTS, which is supported until 2029. Our Trellis was older than 1.33. So:

- **No in-place `do-release-upgrade`.** The login banner now offers 26.04.1. On a Trellis server that is a rebuild job, not a banner click.
- **No new server yet.** That only makes sense after Trellis is on 1.33, and after MariaDB is on a version that has 26.04 packages (below).
- **Pin local VMs before updating trellis-cli.** Otherwise the next `trellis vm` recreate builds 26.04 on a Trellis that cannot provision it:

```yaml
# trellis/trellis.cli.yml
vm:
  instance_name: "website.com"
  ubuntu: "24.04"
```

Updating trellis-cli itself hit a newer Homebrew rule first:

```text
Error: Refusing to load formula roots/tap/trellis-cli from untrusted tap roots/tap.
Run `brew trust --formula roots/tap/trellis-cli` or `brew trust roots/tap` to trust it.
```

`brew trust roots/tap && brew upgrade trellis-cli` sorted it. The same output listed four other taps Homebrew now ignores until you trust them, including `shivammathur/php`. If your Mac's PHP comes from there, it has quietly stopped updating.

## Getting to 1.33 without losing local changes

The tree turned out to be 1.28.0, not the 1.27.0 its changelog claimed. It also carried hand-copied upstream fixes and a pile of local changes. I applied only the upstream changes from 1.28 to 1.33, as a three-way merge, rather than copying upstream over it. That method has [its own write-up](/update-trellis-three-way-merge-git-merge-file-keep-customisations/). The rest of this post is about what 1.33 changes on a running server.

## What 1.33 changes, and what I did about each

**ssmtp is replaced by msmtp.** The `ssmtp` role is gone and a `roots.msmtp` Galaxy role takes its place. It reads the same `mail_smtp_server`, `mail_user`, `mail_password`, `mail_admin` and `mail_hostname` variables, so our Brevo `mail.yml` needed no change. Two things to do: `trellis galaxy install` to fetch the role, and check that `php_sendmail_path` is `/usr/bin/msmtp -t` if you ever overrode it.

**APT repositories move to deb822.** nginx, MariaDB and the Sury PHP repo each get a `.sources` file and a key in `/etc/apt/keyrings`, because `apt-key` no longer exists on 26.04. `nginx_ppa` and `mariadb_ppa` are replaced by `*_repo_uri`, `*_repo_suite` and `*_repo_signing_key`. Provisioning stops with an error if the old names are still in your `group_vars`. Ours were not.

**The PHP repo is now `packages.sury.org`**, not `ppa:ondrej/php`. You notice it in `apt upgrade` output, where version strings change from `8.3.31-3+ubuntu24.04.1+deb.sury.org+1` to `8.3.36-1+0~20261021.88+ubuntu24.04~1.gbp250f7c`. That is expected.

**HTTP/3 is on by default for SSL sites.** Trellis opens UDP 443 in the firewall and adds `listen ... quic` plus an `Alt-Svc` header. Check it after provisioning:

```bash
curl -sI https://website.com | grep -i alt-svc
# alt-svc: h3=":443"; ma=86400
```

**MariaDB 11.8 becomes the default. This is the one to stop at.** The release notes say existing servers are not upgraded automatically: provisioning switches the repository to 11.8 but leaves the installed 10.11 packages in place. Read that again with `apt upgrade` in mind. Once the repo points at 11.8, the next manual `apt upgrade` is what moves you to a new major database version, unplanned and without a backup. I pinned it:

```yaml
# group_vars/all/main.yml
# Trellis 1.33 defaults to MariaDB 11.8. Stay on 10.11 until a planned,
# backed-up major upgrade (see Trellis v1.33.0 release notes).
mariadb_version: "10.11"
```

The 11.8 upgrade will be its own step, with backups and the `mariadb_server_package_state=latest` provision from the release notes. It is also the step that makes a 26.04 server possible later, because 10.11 has no 26.04 packages.

The rest is quieter: Redis PHP sessions, Composer custom-header auth, opt-in runtime hardening (`wordpress_runtime_hardened`, off by default), fastcgi cache fixes, `.txt` and `.md` blocked in plugin directories, and Ansible 2.19 support.

## Development first, then production

Locally, `trellis provision development` finished with `ok=145 changed=38 failed=0` and no warnings. All local sites answered, and a `wp_mail()` test landed in Mailpit. That does **not** test msmtp, because development points `php_sendmail_path` at Mailpit. The Brevo path only exists on production.

Before production I backed up every database on the server: the three WordPress databases with `wp-ops db-backup`, and the Laravel app's three databases with `mysqldump`. A `trellis provision production` touches the shared MariaDB server, so "every database" means every app on the box, not only the WordPress ones.

Production finished at `ok=156 changed=38 failed=0`. The mail test, with msmtp's debug output, shows Brevo's actual answer instead of just `wp_mail()` returning `true`:

```bash
printf "To: you@example.com\nSubject: msmtp test\n\nTest.\n" | msmtp --debug -t 2>&1 | grep '^<-- 250'
# <-- 250 2.0.0 OK: queued as <...>
```

It arrived in my inbox a moment later.

## Provisioning does not update the server

This surprised me more than anything in the release. After provisioning, the server still had about 90 packages waiting. Trellis sets:

```yaml
apt_package_state: present
apt_security_package_state: latest
```

So the packages Trellis manages are only kept installed, apart from a short security list. The kernel, systemd, libc and everything else Trellis does not manage are never touched. `unattended-upgrades` was installed and handles security updates, and none of the 90 were security updates. They were ordinary updates, and they needed a manual `apt upgrade`.

## The apt upgrade, prompt by prompt

- **A keyboard layout dialog** (`keyboard-configuration`) on a headless server. Any answer works. I picked English (US).
- **`50-server.cnf` was "modified since installation"**, with the maintainer's version on offer. Keep yours (`N`, the default). Trellis wrote that file from its template, and the stock one would drop your MariaDB tuning until the next provision. The same goes for any sshd, nginx, PHP or fail2ban config prompt.
- **A pending kernel**, 6.8.0-147 running and 6.8.0-149 installed. needrestart restarted the services it could, including `ssh.service`.

Restarting ssh ended my root session. It also left a dead SSH multiplexing connection on my Mac, so the next `ssh` hung instead of connecting (`mux_client_request_session: read from master failed: Broken pipe`). `ssh -o ControlMaster=no -o ControlPath=none ...` or `ssh -O exit host` clears it.

Before rebooting, check that everything you need starts at boot. A Laravel queue worker under systemd is easy to forget:

```bash
for s in nginx mariadb php8.4-fpm redis-server fail2ban ferm cron your-worker; do
  printf "%-16s %s\n" $s "$(systemctl is-enabled $s)"; done
```

Then `reboot` from the shell, not a hard reset in the cloud console, so MariaDB shuts down cleanly. The server was back in about 20 seconds: kernel 6.8.0-149, no failed units, all four sites returning 200, Horizon running, and a second Brevo test accepted.

One thing turned up along the way. The server still had PHP 8.2 and 8.3 packages from before the 8.4 switch, and apt was faithfully upgrading them. Their FPM services were disabled and not running, so they cost disk space, not memory. They are next on the cleanup list.

## The short version

| Question | Answer |
|---|---|
| Upgrade the server to 26.04? | No. 24.04 is supported to 2029, and 26.04 needs Trellis 1.33 plus MariaDB 11.8 |
| Update trellis-cli? | Yes, after pinning `vm.ubuntu: "24.04"` |
| Upgrade Trellis to 1.33? | Yes, merged rather than copied, tested on the VM first |
| Does provisioning update packages? | No. Run `apt upgrade` and reboot for kernels |
| MariaDB 11.8? | Pin 10.11 now, upgrade on purpose later |

I haven't tested an actual HTTP/3 connection end to end. My local curl lacks HTTP/3 support, so all I confirmed is that the server advertises `h3`.

---

*Running Trellis on 26.04 already, or did the MariaDB 11.8 upgrade bite you? Find me on Mastodon at [@jfrumau@mastodon.social](https://mastodon.social/@jfrumau).*
