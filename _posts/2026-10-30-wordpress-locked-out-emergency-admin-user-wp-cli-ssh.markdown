---
layout: post
title: "Locked Out of WordPress: Create a Temporary Admin With WP-CLI Over SSH, Then Delete It"
date: 2026-10-30 10:00:00 +0700
categories: wordpress wp-cli security
tags: [wordpress, wp-cli, security, admin, recovery, lockout, ssh, trellis]
case_category: security
case_status: documented
---

A lost admin password, a plugin that broke the login, an admin email that no longer exists: when you cannot log in but you can reach the server, WP-CLI gets you back in without touching a PHP file. A temporary administrator exists for a few minutes and then you delete it.

## The command

```bash
ssh admin_user@yoursite.com
cd /srv/www/yoursite.com/current

wp user create recovery_admin recovery@yoursite.com --role=administrator --path=web/wp
```

When you leave out `--user_pass`, WP-CLI generates a password and prints it once. Copy it, log in at `/wp-admin`, and fix the real problem. On Bedrock the `--path=web/wp` is needed unless the site has a [`wp-cli.yml`]({% post_url 2026-10-30-bedrock-wp-cli-yml-and-pattern-validate-block-pattern-files %}) that sets it.

If you want to choose or generate the password yourself, do it without leaving it in the shell history or the process list. The [one-liner post]({% post_url 2026-09-21-wp-cli-generate-password-one-liner %}) shows how.

Then, before you do anything else, think about when you will delete the user. Leaving a `recovery_admin` account around is a backdoor you made yourself.

## Delete it when you are done

```bash
# What admin accounts exist?
wp user list --role=administrator --format=csv --path=web/wp

# Delete by login
wp user delete recovery_admin --yes --path=web/wp

# If it ever wrote content, hand that to a real user instead of deleting it
wp user delete recovery_admin --yes --reassign=1 --path=web/wp
```

The list is worth reading even when everything is fine. An administrator you do not recognise is the first sign of a compromised site, and the [security routine post]({% post_url 2026-10-29-trellis-wordpress-security-routine-abuseipdb-fail2ban %}) covers what to do then.

## The errors you will see

**Email already exists, or username already registered.** WordPress needs both to be unique.

```bash
wp user list --field=user_email --path=web/wp | grep recovery@yoursite.com
wp user get recovery_admin --field=user_login --path=web/wp
```

Pick another login or address. If the account you already have is the one you are locked out of, `wp user update` is the faster fix:

```bash
wp user update admin --user_pass="$(openssl rand -base64 18)" --path=web/wp
```

Note that this puts the password on the command line. The one-liner post above shows the variant that does not.

**You created the user but cannot log in.** Check the role and the email:

```bash
wp user get recovery_admin --fields=user_login,roles,user_email --path=web/wp
```

If the role is right, look at what is blocking the login itself: a security plugin, a login rate limit at the server, or a broken `wp-login.php`.

**Mail from the new user bounces.** An admin email that does not exist is also the cause of "WordPress mail not arriving", covered in [the mail post]({% post_url 2026-10-28-trellis-mail-not-sending-smtp-config-reset-and-bounces %}).

## Scripting it

The simplest version of this is a script that refuses to create a second account and reminds you to clean up:

```bash
#!/bin/bash
cd /srv/www/yoursite.com/current || exit 1
USERNAME="deploy_temp_admin"

if ! wp user get "$USERNAME" --path=web/wp &>/dev/null; then
  wp user create "$USERNAME" "deploy@yoursite.com" --role=administrator --path=web/wp
  echo "Delete it after use: wp user delete $USERNAME --yes --path=web/wp"
fi
```

wp-ops has an `admin-user-create` command for the same job, with the cleanup reminder built in.
