---
layout: post
title: "Trellis Provision Fails at \"Set root user password\": The Password Is Fine, MariaDB Isn't Running (provider_bzip2.so)"
date: 2026-10-28 15:00:00 +0700
categories: wordpress trellis mariadb
tags: [wordpress, trellis, mariadb, ansible, ubuntu, debugging, devops, provisioning]
case_category: debugging
case_status: documented
---

A Trellis provision stopped in the MariaDB role with this:

```
TASK [mariadb : Set root user password] ****************************************
failed: [203.0.113.10] (item=None) => {"censored": "...no_log: true..."}
```

The task is called "Set root user password" and its output is censored by `no_log`, so the obvious suspects are credentials: a wrong vault value, a root password already set differently, a socket permission. The real cause was one step earlier. MariaDB was not running.

## Check the service before the password

The role sets the password by connecting to the database. If nothing is listening, the task fails the same way a bad password would, and `no_log` hides the difference. So ask the server first:

```bash
ssh -t admin@example.com "sudo systemctl status mariadb"
ssh -t admin@example.com "sudo journalctl -u mariadb -n 50"
```

Here the status was a failed start, and the journal had the real reason:

```
[ERROR] mariadbd: Can't open shared library '/usr/lib/mysql/plugin/provider_bzip2.so'
[ERROR] Couldn't load plugins from 'provider_bzip2.so'.
[ERROR] /usr/sbin/mariadbd: unknown variable 'provider_bzip2=force_plus_permanent'
[ERROR] Aborting
```

In `systemctl status`, `status=7/NOTRUNNING` and `Failed to start mariadb.service` mean the same thing. Once you see them, the provision error is a symptom, not a separate problem.

## What the error means

MariaDB's optional compression providers (bzip2, lz4, lzma, lzo, snappy) each have a config file in `/etc/mysql/mariadb.conf.d/`:

```
provider_bzip2.cnf   provider_lz4.cnf   provider_lzma.cnf
provider_lzo.cnf     provider_snappy.cnf
```

A file like `provider_bzip2.cnf` tells the server to load the plugin and refuse to start without it (`force_plus_permanent`). The server did exactly that: the config was present, the shared library was not, so it aborted.

Check it directly:

```bash
ls /etc/mysql/mariadb.conf.d/provider_*.cnf
ls /usr/lib/mysql/plugin/provider_*.so
```

Configs without matching `.so` files are your culprits. I did not establish how the server got into that state. Plausible routes are a package removed without purging its config, or config files added without the packages. Either way the symptom and the fix are the same.

## Fix A: set the unused configs aside (what I did)

WordPress does not need these. Rename the configs so MariaDB stops reading them (it only includes files ending in `.cnf`):

```bash
cd /etc/mysql/mariadb.conf.d
for p in bzip2 lz4 lzma lzo snappy; do
  [ -f provider_$p.cnf ] && sudo mv provider_$p.cnf provider_$p.cnf.disabled
done
sudo systemctl start mariadb
sudo systemctl status mariadb
```

If some providers do have their `.so`, rename only the ones that do not.

## Fix B: install the plugins

If you actually want the compression algorithms, install the packages instead:

```bash
sudo apt update
sudo apt install mariadb-plugin-provider-bzip2 mariadb-plugin-provider-lz4 \
  mariadb-plugin-provider-lzma mariadb-plugin-provider-lzo mariadb-plugin-provider-snappy
sudo systemctl restart mariadb
```

Package names can differ by MariaDB version and Ubuntu release, so check with `apt search mariadb-plugin-provider`.

## Does disabling them cost anything?

For a normal WordPress database, no. These providers add extra algorithms for InnoDB page compression, which WordPress tables do not use by default, and zlib stays built in. The one case to check first is a database where someone set page compression to lz4, lzma, lzo, snappy or bzip2 on purpose: those tables need the matching plugin to be read. If that is you, use fix B.

## Finish the provision

With MariaDB running, re-run just the database role:

```bash
cd trellis
trellis provision --tags mariadb production
```

Then confirm the sites work and the database answers, either through WordPress (`wp db check --path=web/wp` from a site directory) or by loading a page that hits the database.

## What I would do next time

1. **When a role fails with `no_log`, check the service, not the credentials.** The task name describes what Ansible was attempting, not why it failed.
2. **Read `journalctl -u mariadb` first.** It names the cause in plain text, and Ansible's output cannot.
3. **Test major changes on staging.** A MariaDB that will not start on production blocks every site on the box.
4. **Optional features can stop a core service.** A missing plugin library should not take a database down, but a `force_plus_permanent` setting makes it do exactly that.
