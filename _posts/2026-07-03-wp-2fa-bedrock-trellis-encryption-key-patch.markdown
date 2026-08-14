---
layout: post
title: "WP 2FA on Roots Bedrock/Trellis: Per-Environment Encryption Keys and a Composer Patch for a Fatal Bug"
date: 2026-07-03 14:00:00 +0700
categories: wordpress php security
tags: [wordpress, php, security, 2fa, bedrock, trellis, composer]
case_category: security
case_status: hardened
---

We added [WP 2FA](https://wordpress.org/plugins/wp-2fa/) (two-factor authentication) to a client site this week to help lock down `/wp-login.php` after a brute-force wave that hit us — 20 IPs, 176 to 851 login attempts each in 48 hours. Blocking the IPs at the Nginx level stops that specific wave, but 2FA is the actual fix: even a leaked or brute-forced password stops being enough on its own.

Getting it working cleanly on a [Roots Bedrock](https://roots.io/bedrock/)/[Trellis](https://roots.io/trellis/) stack took two separate fixes, not one.

## The Encryption Key Problem

WP 2FA stores an encryption key for 2FA secrets in the `wp_options` table by default, under `wp_2fa_secret_key`. That's fine for a stock WordPress install, but Bedrock keeps environment-specific config *out* of `wp-config.php` and out of the database — everything lives in `.env` and `config/environments/{development,staging,production}.php`, loaded via `Roots\WPConfig\Config`. A secret sitting in the database instead of environment config breaks that model, and WP 2FA actually warns you about it on its own settings page.

[Dave at barrd.dev wrote up the fix for this back in 2023](https://barrd.dev/article/wordpress-install-2fa-plugin-when-using-roots-bedrock/), and it's still the right approach:

1. Deactivate the plugin.
2. Copy the key from `wp_options` (`wp_2fa_secret_key`, watch for a non-`wp_` table prefix).
3. Move it into the environment config file instead:

```php
// config/environments/production.php
use Roots\WPConfig\Config;

Config::define('WP2FA_ENCRYPT_KEY', 'your-encryption-key-here');
```

4. Delete the `wp_2fa_secret_key` row from the database.
5. Reactivate the plugin.

The one thing worth adding to that: **give each environment its own key**, not the same value copied into both files. Development and production are different databases with different 2FA-secret data, so there's no reason to share a key between them — if anything, sharing weakens the isolation between environments for no benefit.

```php
// config/environments/development.php
Config::define('WP2FA_ENCRYPT_KEY', 'a-different-key-for-dev');

// config/environments/production.php
Config::define('WP2FA_ENCRYPT_KEY', 'a-different-key-for-production');
```

Generate each with `wp_generate_password(32, false)` or `openssl rand -base64 24` — anything sufficiently random works, since it's only ever read by `Config::define()`.

## The Second Problem: A Fatal Bug barrd.dev Didn't Hit

Once the encryption key was sorted, saving the plugin's **Policies** tab threw a fatal error under `WP_DEBUG` in development (and silently no-op'd in production, which is worse — it just quietly doesn't save).

The plugin's Policies settings page has an option to generate a custom "user account" page for the 2FA setup wizard. If you never enable that option, `custom-user-page-id` stays an empty string. But the save handler calls `wp_delete_post()` unconditionally whenever certain settings change, without checking that a page ID actually exists:

```php
// includes/classes/Admin/SettingsPages/class-settings-page-policies.php (WP 2FA 3.1.1.2)
\wp_delete_post( WP2FA::get_wp2fa_setting( 'custom-user-page-id' ), true );
```

`wp_delete_post('')` isn't a no-op in every code path — it's enough to throw a fatal type error under `WP_DEBUG`. This is a plugin bug, not something we control, so the fix has to live at the vendor-patch level rather than in our own code.

### Patching a Composer-Installed Plugin

Bedrock installs plugins via Composer, so hand-editing the file in `vendor/`/`web/app/plugins/` doesn't survive the next `composer install`. The standard way to patch a Composer dependency and have the patch reapply automatically is [`cweagans/composer-patches`](https://github.com/cweagans/composer-patches).

Add it as a dependency and allow it to run:

```json
{
  "require": {
    "cweagans/composer-patches": "^1.7"
  },
  "config": {
    "allow-plugins": {
      "cweagans/composer-patches": true
    }
  },
  "extra": {
    "patches": {
      "wpackagist-plugin/wp-2fa": {
        "Fix wp_delete_post() fatal on Policies save when no custom user page exists": "patches/wp-2fa-fix-custom-user-page-delete.patch"
      }
    }
  }
}
```

Then the patch itself, guarding the delete with an actual ID check:

```diff
--- a/includes/classes/Admin/SettingsPages/class-settings-page-policies.php
+++ b/includes/classes/Admin/SettingsPages/class-settings-page-policies.php
@@ -419,7 +419,10 @@
 					$output['custom-user-page-id']         = '';
 					$output['separate-multisite-page-url'] = '';
 					$output['hide_page_generated_by']      = '';
-					\wp_delete_post( WP2FA::get_wp2fa_setting( 'custom-user-page-id' ), true );
+					$custom_user_page_id = (int) WP2FA::get_wp2fa_setting( 'custom-user-page-id' );
+					if ( $custom_user_page_id > 0 ) {
+						\wp_delete_post( $custom_user_page_id, true );
+					}
 				}
 			}
```

`composer install` (or `composer update wpackagist-plugin/wp-2fa`) applies it automatically from then on — no manual edits to `vendor/` after every deploy, and the patch travels with the repo so every environment gets the same fix.

## Why Bother With Both Fixes

It would've been easy to stop at "the plugin works, 2FA is enabled" and leave the Policies-tab bug alone since it only breaks a secondary settings page, not authentication itself. But a settings page that silently fails to save in production is exactly the kind of thing that causes a support ticket three months from now when someone tries to change a policy and can't figure out why nothing sticks. Composer patches are cheap insurance for that — a few lines, applied automatically, documented in the repo instead of tribal knowledge.

## Summary

- Bedrock/Trellis stacks need 2FA secrets moved out of the database and into `config/environments/*.php`, per environment — [barrd.dev's original write-up](https://barrd.dev/article/wordpress-install-2fa-plugin-when-using-roots-bedrock/) covers the mechanics.
- Give dev and production separate `WP2FA_ENCRYPT_KEY` values.
- If you hit a fatal error saving WP 2FA's Policies tab, it's a real bug in the plugin (`wp_delete_post()` called without checking the ID first) — patch it with `cweagans/composer-patches` rather than editing `vendor/` by hand.

This is part of the hardening work we do as part of managed Trellis/Bedrock hosting at [Imagewize](https://imagewize.com) — brute-force IP blocking, rate limiting, and now 2FA rollout. If you're running a Bedrock/Trellis stack and want a hand with your security setup, [get in touch](https://imagewize.com/contact/).

---

*Find me on Mastodon at [@jfrumau@mastodon.social](https://mastodon.social/@jfrumau) if you've hit other WP 2FA quirks on a Bedrock stack.*
