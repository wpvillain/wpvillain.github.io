---
layout: post
title: "WordPress Mail Not Arriving on Trellis: Two Different Failures That Look the Same (Config Reset vs Bounces)"
date: 2026-10-28 13:00:00 +0700
categories: wordpress trellis email
tags: [wordpress, trellis, email, smtp, msmtp, multisite, wp-cli, debugging, devops]
case_category: debugging
case_status: documented
---

"WordPress emails aren't arriving" has at least two unrelated causes on a Trellis server, and they need opposite fixes. In one the mail never leaves the server. In the other it leaves fine and the recipient's server throws it back. The quickest way to tell them apart is to find out where the mail stopped.

## Failure 1: the mail never leaves (a Trellis upgrade reset `mail.yml`)

After a Trellis upgrade, cron jobs and WordPress mail started failing quietly. The cause was `trellis/group_vars/all/mail.yml`, which had been replaced by the stock placeholder file:

```yaml
mail_smtp_server: smtp.example.com:587
mail_admin: admin@example.com
mail_hostname: example.com
mail_user: smtp_user
mail_password: "{{ vault_mail_password }}"
```

The server was now trying to relay through `smtp.example.com`. The system log shows it:

```bash
ssh -t admin@example.com "sudo journalctl -b | grep -i -E 'smtp|sendmail|MTA' | tail -50"
```

```
Unable to locate smtp.example.com
sendmail: Cannot open smtp.example.com:587
MAIL (mailed 65 bytes of output but got status 0x0001 from MTA)
```

Use the admin user for this, since the `web` user has no sudo. If you see your placeholder hostname in those lines, the config was reset. Restore the real values in `mail.yml`, keep the password in the vault (`vault_mail_password` in `group_vars/all/vault.yml`), and re-provision only the mail role:

```bash
cd trellis
trellis provision --tags mail production
```

Current Trellis installs msmtp for this, and older versions used sSMTP, so the tag and the config file under `/etc` depend on your version. Check `server.yml` for the role name rather than trusting a guide. I could not confirm the tag against a vendored copy of the role here, so treat `mail` as the first thing to try and `ansible-playbook server.yml --list-tags` as the check.

Then prove the server can send before you touch WordPress:

```bash
ssh web@example.com "echo -e 'Subject: Test\n\nTest' | /usr/sbin/sendmail -v you@example.com"
```

A healthy run shows `Authentication succeeded` and `queued as`. If this works, WordPress mail is not your problem yet.

**Prevent it:** commit your `group_vars` before upgrading Trellis, diff them afterwards, and send a test mail within a day. It is the kind of failure nobody notices until a client asks where their form submissions went.

## Failure 2: the mail leaves, then bounces (the admin email does not exist)

Here the server relay is fine. The relay's dashboard (I use Brevo) shows the message accepted, then:

```
From: wordpress@demo.example.com
To:   admin@demo.example.com
Status: Soft bounce
Error: connection closed by recipient's server
```

Nothing is wrong with SMTP. WordPress is sending to an address with no mailbox behind it. This is common on Multisite, where the network admin email was set to something like `admin@demo.example.com` on a domain that has no mail, and every new-site registration and notice goes there.

The relay log is the discriminator. If the message is in it, the server did its job and the problem is the recipient. If it is not in it, go back to failure 1.

Find the offending addresses. On a single site:

```bash
ssh web@example.com "cd /srv/www/example.com/current && wp option get admin_email --path=web/wp"
```

On a network, check the network option and every subsite:

```bash
wp site option get admin_email --path=web/wp --url=https://example.com

for site in $(wp site list --field=url --path=web/wp --url=https://example.com); do
  echo "$site -> $(wp option get admin_email --path=web/wp --url=$site)"
done
```

Fix them. The network option and each site's own option are separate:

```bash
wp site option update admin_email 'real@example.com' --path=web/wp --url=https://example.com

for site in $(wp site list --field=url --path=web/wp --url=https://example.com); do
  wp option update admin_email 'real@example.com' --path=web/wp --url=$site
done
```

One catch from [an earlier post]({% post_url 2026-09-03-wordpress-admin-email-password-wp-cli %}): the Settings screen field does not write to `admin_email` directly, it starts a confirmation flow. `wp option update` does write it, which is why it is the right tool here.

Then test through WordPress itself:

```bash
wp eval 'var_dump( wp_mail( "you@example.com", "Test", "Test" ) );' --path=web/wp --url=https://example.com
```

`bool(true)` only means WordPress handed the message to the mail system. Confirm it landed in the inbox, or look it up in the relay dashboard. On a network, creating a throwaway subsite with `wp site create --slug=test-registration --email=you@example.com` exercises the registration mail that was failing.

## Pitfalls

- A subdomain such as `admin@demo.example.com` is only valid if you made that mailbox.
- Do not carry a development address like `admin@example.test` into production.
- A passing `wp_mail()` does not prove delivery. The relay dashboard does, so watch it for bounces.

If your own local mail testing is the problem instead, [catching mail locally with MailHog]({% post_url 2026-08-14-mailhog-local-wordpress-email-testing %}) covers that side.
