---
layout: post
title: "Let's Encrypt Greyed Out on Shared Hosting: A wp-config.php HTTP Override and an openssl Check"
date: 2026-11-11 11:00:00 +0700
categories: wordpress hosting devops
tags: [wordpress, ssl, letsencrypt, shared-hosting, wp-config, openssl, troubleshooting]
case_category: devops
case_status: documented
---

A fresh WordPress install on a shared host, set to https, and `/wp-admin/` returned the host's default 404 page. Not a WordPress error, not a certificate warning, just the wrong site. It took a day, two wrong theories and a package upgrade to get a valid certificate, and one `openssl` one-liner told us exactly where we stood at every step.

## Symptom: wp-admin hits the server's default page

The domain had no certificate of its own yet. The panel's SSL option was on, but nothing had been issued, so the https request for the domain fell through to the server's default vhost. That is why it looked like a 404 and not a certificate error in the first place: the shared server answered with the default site.

WordPress itself was fine. The Site URL and Home URL were already `https://`, so every admin request got redirected to a host that could not serve it.

## Temporary fix: force HTTP in wp-config.php

To get into the admin at all, I pinned both URLs to http over FTP:

```php
/**
 * Custom WordPress URLs for when SSL/HTTP Fails
 */
define( 'WP_HOME',    'http://example.nl' );
define( 'WP_SITEURL', 'http://example.nl' );
```

Constants in `wp-config.php` win over the database values, which is also why the Site URL fields in Settings → General turn grey while they are defined. That makes it a clean temporary override: nothing in the database changes, and removing the two lines puts everything back. Do not use it as the permanent fix; it just parks the problem.

## Wrong theory one: we broke the SSL settings

In the panel, the site's SSL tab showed the SSL action set to `None`. That looked like an accidental save, and it would explain why Let's Encrypt could not be switched on. There were also key, request and certificate fields filled in that nobody on our side recognized, so we left them alone.

Resetting that was not the fix. The `None` was most likely just the default state of a domain without a certificate.

## Wrong theory two: it is not a plan limit

On the Domain tab, the Let's Encrypt toggle was greyed out. Next to it was a hint saying it is available from the Power package. We dismissed it, because two other domains on the same hosting account already had Let's Encrypt wildcard certificates, so we assumed the hint was generic text and Let's Encrypt had been switched off for this one domain on the provider's side.

That reasoning was wrong. The other domains were on the Power package. This one was on the cheaper Allround package. The panel hint was literal, and we talked ourselves out of reading it. A ticket to the host and the site owner's reply about the package settled it: the owner upgraded this one domain to Power.

If a toggle is greyed out and a hint explains why, compare the plan of the domain that works with the plan of the one that does not before building a theory.

## Turning it on and watching it arrive

After the upgrade, the Let's Encrypt toggle was no longer greyed out. I switched it on, saved, and the panel showed a banner that the change had been requested on the server and could take a few minutes. I removed the http override from `wp-config.php` at the same time, so the next test would be a real one.

Every check is the same command, so I could watch the state change:

```bash
echo | openssl s_client -connect example.nl:443 -servername example.nl 2>/dev/null \
  | openssl x509 -noout -issuer -subject -dates
```

`-servername` matters: without SNI you get the server's default certificate, not the one for your domain. Three stages showed up:

1. **The shared host certificate.** Issuer a commercial CA, subject the hosting company's own domain. No certificate for our domain yet. `curl -I https://example.nl/` failed with "no alternative certificate subject name matches".
2. **A connection reset.** `curl` returned "Recv failure: Connection reset by peer" and `openssl` printed "Could not find or decode certificate". This was the server reloading the vhost while it applied the change. It looks alarming, but it was progress.
3. **The Let's Encrypt certificate.** Issuer Let's Encrypt, subject `*.example.nl` with `example.nl` in the alternative names, valid for 90 days.

From saving the toggle to a certificate that verified took roughly ten to fifteen minutes. The reset stage was a few minutes of that.

## Verify the way a browser would, without -k

Once the certificate looked right, I checked it end to end:

```bash
curl -sS -I https://example.nl/wp-login.php
```

HTTP 200 with no `-k` means curl trusted the certificate chain. At that moment Chrome still showed a certificate warning for the same URL. When the command line verifies and the browser does not, believe the command line first, then restart the browser or use a private window before touching the server again. Also confirm DNS for both the bare domain and `www` points at the right IP:

```bash
dig +short example.nl www.example.nl
```

## Clean up the override

As soon as https worked, the override had no job left. In `wp-config.php` I commented the two `define()` lines out (deleting them is just as good), confirmed Settings → General showed `https://` for both URLs, and loaded the admin over https. The `/wp-admin/` request now redirected to https and landed on a working login page.

Final checklist:

- `openssl s_client` shows a Let's Encrypt issuer and your domain in the subject or SAN.
- `curl -I` over https returns 200 without `-k`.
- `WP_HOME` and `WP_SITEURL` are removed from `wp-config.php`.
- Site URL and Home URL both read `https://` in Settings → General.
- Check the browser console for mixed content on a page with images.
- Close the support ticket, the problem is gone.

## What I would do next time

Read the hint next to a greyed-out control first, and compare it against the plan the working domains are on. Keep the http override in `wp-config.php` as a short-lived escape hatch with a comment that says when it can go. And keep that one `openssl s_client` command handy: it shows you what the server is actually serving, not what the panel says it should be.
