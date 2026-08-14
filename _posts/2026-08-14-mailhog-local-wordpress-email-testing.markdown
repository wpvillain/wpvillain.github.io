---
layout: post
title: "Catching WordPress Emails Locally with MailHog (No More Test Mail Hitting Real Inboxes)"
date: 2026-08-14 10:00:00 +0700
categories: wordpress php devops
tags: [wordpress, php, devops, mailhog, smtp, valet, local-development, testing]
---

Every WordPress site sends more mail than people think: password resets, contact form notifications, WooCommerce order confirmations, plugin alerts. That's fine in production. It's a liability in local development — the last thing you want is a bug in a test script firing a "your order has shipped" email at an actual customer, or a password-reset flood landing in a real inbox while you're debugging a form.

[MailHog](https://github.com/mailhog/MailHog) solves this cleanly: it's a local SMTP server that catches every outgoing email instead of delivering it, and gives you a web UI to inspect what WordPress actually sent — headers, body, attachments — without any of it leaving your machine.

Here's how it's set up on a [Laravel Valet](https://laravel.com/docs/valet) local WordPress install.

## The Setup

| Component | Details |
|-----------|---------|
| **Web Server** | Laravel Valet |
| **MailHog** | Installed via Homebrew, running as a service |
| **SMTP Port** | 1025 |
| **Web UI Port** | 8025 |
| **WordPress Config** | Must-use plugin in `wp-content/mu-plugins/` |

MailHog was already available via Homebrew:

```bash
brew list | grep mailhog
ps aux | grep mailhog
```

It runs as a persistent background process — it survives Valet restarts, so there's no per-session setup once it's running.

## Wiring WordPress to MailHog

WordPress sends mail through `wp_mail()`, which under the hood uses PHPMailer. Rather than touch PHP's `sendmail_path` or reach for a full SMTP plugin, a small must-use plugin is enough to redirect PHPMailer at MailHog's SMTP port:

```php
<?php
/**
 * Plugin Name: MailHog SMTP Override
 * Description: Configures WordPress to send emails through MailHog SMTP (localhost:1025)
 * Version: 1.0
 */

if (!defined('ABSPATH')) {
    exit;
}

add_action('phpmailer_init', 'mailhog_configure_smtp');
function mailhog_configure_smtp($phpmailer) {
    $phpmailer->isSMTP();
    $phpmailer->Hostname = 'example.test';
    $phpmailer->Host = 'localhost';
    $phpmailer->Port = 1025;
    $phpmailer->SMTPSecure = false;
    $phpmailer->SMTPAutoTLS = false;
    $phpmailer->SMTPAuth = false;

    if (empty($phpmailer->From)) {
        $phpmailer->From = 'noreply@example.test';
    }
    if (empty($phpmailer->FromName)) {
        $phpmailer->FromName = 'Example Site';
    }
}
```

Save that as `wp-content/mu-plugins/mailhog-smtp.php` and it loads automatically — must-use plugins don't need activating, and they can't accidentally get deactivated mid-debug session either, which matters here since the whole point is that this stays on for every local request.

No authentication, no TLS — MailHog doesn't need either since nothing actually leaves localhost.

## Verifying It Works

```bash
wp eval-file /dev/stdin <<'PHP'
<?php
$to = 'test@example.com';
$subject = 'MailHog Test Email';
$message = 'This is a test email sent through MailHog SMTP';
$result = wp_mail($to, $subject, $message);
echo "Email sent: " . ($result ? "SUCCESS" : "FAILED") . "\n";
PHP
```

Then open `http://localhost:8025` — the email shows up in the inbox immediately, with full headers and body, and it never touched `test@example.com` for real.

## Day-to-Day Use

**View emails:** `http://localhost:8025` — click any message for headers, body, and attachments.

**Clear the inbox** via the UI, or via the API:

```bash
curl -X DELETE http://localhost:8025/api/v1/messages
```

**Check message count** (useful in a script or CI-style check after a test run):

```bash
curl -s http://localhost:8025/api/v2/messages | jq '.total'
```

Multiple recipients and HTML email both work exactly as they would against a real SMTP server — MailHog doesn't need special-casing for either:

```php
wp_mail('user1@example.com, user2@example.com', 'Subject', 'Message');
wp_mail('test@example.com', 'HTML Email', '<h1>Hello</h1><p>This is HTML</p>');
```

## If Emails Don't Show Up

Work through these in order — in practice it's almost always the first one:

1. **Is MailHog actually running?**
   ```bash
   ps aux | grep mailhog
   ```
2. **Is something listening on 1025?**
   ```bash
   lsof -i :1025
   ```
3. **Manual SMTP smoke test:**
   ```bash
   telnet localhost 1025
   ```
   Type `HELO test`, then `QUIT` — if that hangs or refuses, the problem is MailHog itself, not WordPress.
4. **Check the WordPress debug log** for a PHPMailer error the mu-plugin didn't catch:
   ```bash
   tail -f wp-content/debug.log
   ```

If MailHog isn't running at all, `mailhog &` starts it manually, or `brew services start mailhog` if it's registered as a service. Port conflicts on 1025/8025 are the other common failure — `lsof -i :1025` / `lsof -i :8025` to find the PID, `kill -9` it, then restart MailHog.

## Alternatives

If a full SMTP plugin fits the project better than a bare mu-plugin, [WP Mail SMTP](https://wordpress.org/plugins/wp-mail-smtp/) points at the same MailHog port through its own settings screen (Mailer: Other SMTP, Host: `localhost`, Port: `1025`, Encryption: None, Authentication: Off) — same destination, more UI for anyone who'd rather not touch PHP.

The one case a `phpmailer_init` hook can't catch: code that bypasses `wp_mail()` entirely and calls PHP's `mail()` directly. That needs `sendmail_path` overridden in `php.ini` instead, which is more invasive and worth avoiding unless something in your stack actually forces it.

## Summary

- MailHog catches outgoing WordPress mail locally instead of delivering it — no risk of test runs emailing real people.
- A single `phpmailer_init` mu-plugin is enough to redirect `wp_mail()` at MailHog's SMTP port; no plugin activation, no config file changes.
- The web UI (`localhost:8025`) and its REST API cover everything you need day to day: inspecting, clearing, and counting captured mail.
- Keep MailHog running as a background service so it survives Valet restarts and there's nothing to remember to start.

This is the same kind of local-environment hygiene we set up as part of managed WordPress hosting work at [Imagewize](https://imagewize.com) — getting a dev environment that behaves like production without any of the production risk. If you're setting up a WordPress local dev workflow and want a hand, [get in touch](https://imagewize.com/contact/).

---

*Find me on Mastodon at [@jfrumau@mastodon.social](https://mastodon.social/@jfrumau) if you've got a MailHog or local-mail setup worth comparing notes on.*
