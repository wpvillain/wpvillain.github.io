---
layout: post
title: "Webreus Let's Encrypt Greyed Out? It Is a Power Package Feature (Plus a wp-config.php HTTP Override and an openssl Check)"
date: 2026-11-11 11:00:00 +0700
categories: wordpress hosting devops
tags: [wordpress, ssl, letsencrypt, webreus, shared-hosting, wp-config, openssl, troubleshooting]
case_category: devops
case_status: documented
---

A fresh WordPress install on shared hosting at Webreus.nl, the Dutch hoster, set to https, and `/wp-admin/` returned the server's default 404 page. Not a WordPress error, not a certificate warning, just the wrong site. The Let's Encrypt toggle in the panel was greyed out. It took a day of confusion over where Let's Encrypt is allowed before the answer turned out to be simple: it is part of the **Power** package, and this domain was on **Allround**. Once that was changed, the certificate arrived fast.

If you run a site on Webreus.nl and the toggle will not switch on, this may save you the same detour. Domain details are anonymized below.

## Symptom: wp-admin hits the server's default page

The domain had no certificate of its own yet. SSL was on in the panel, but nothing had been issued, so the https request for the domain fell through to the server's default vhost. That is why it looked like a 404 and not a certificate error: the shared server answered with a site that was not ours.

WordPress itself was fine. The Site URL and Home URL were already `https://`, so every admin request got redirected to a host that could not serve it properly.

## Temporary fix: force HTTP in wp-config.php

To get into the admin at all, I pinned both URLs to http over FTP:

```php
/**
 * Custom WordPress URLs for when SSL/HTTP Fails
 */
define( 'WP_HOME',    'http://example.nl' );
define( 'WP_SITEURL', 'http://example.nl' );
```

Constants in `wp-config.php` win over the database values, which is also why the Site URL fields in Settings → General turn grey while they are defined. That makes it a clean temporary override: nothing in the database changes, and removing the two lines puts everything back. Do not use it as the permanent fix; it only parks the problem.

## Where the confusion came from

In the Webreus panel, Let's Encrypt is set on the **Domain** tab of the website, not on the SSL tab. That alone cost time: the SSL tab says Let's Encrypt is not enabled there and points you to the Domain tab.

Two things looked like clues and were not:

1. **The SSL tab showed the SSL action set to `None`.** That looked like an accidental save, which would explain why Let's Encrypt would not switch on. It was probably just the state of a domain without a certificate. Resetting it was not the fix.
2. **The Let's Encrypt toggle on the Domain tab was greyed out**, with a hint saying it is available from the Power package. We doubted that hint, because other domains on the same account already had Let's Encrypt wildcard certificates. What we had not compared was the package: those domains were on Power, and this one was on Allround.

So the hint was literal, and the sibling domains were no contradiction. The Webreus support team was helpful throughout, and the whole thing was a confusion about where Let's Encrypt is allowed, not a fault on their side. The site owner upgraded this one domain from Allround to Power.

The lesson is cheap: when a control is greyed out with an explanation, check the package of the domain that works against the package of the one that does not, before building a theory.

## Turning it on: fast

After the upgrade, the Let's Encrypt toggle was no longer greyed out. I switched it on, saved, and the panel showed a banner that the change had been requested on the server and could take a few minutes. I removed the http override from `wp-config.php` at the same time, so the next test would be a real one.

Activation was quick. I watched it with one command, repeated:

```bash
echo | openssl s_client -connect example.nl:443 -servername example.nl 2>/dev/null \
  | openssl x509 -noout -issuer -subject -dates
```

`-servername` matters: without SNI you get the server's default certificate, not the one for your domain. Three stages showed up:

1. **The shared host certificate.** Subject the hosting company's own domain. No certificate for our domain yet, and `curl -I https://example.nl/` failed with "no alternative certificate subject name matches".
2. **A connection reset.** `curl` returned "Recv failure: Connection reset by peer" and `openssl` printed "Could not find or decode certificate". This was the server reloading the vhost while it applied the change. It looks alarming, but it was progress.
3. **The Let's Encrypt certificate.** Issuer Let's Encrypt, subject `*.example.nl` with `example.nl` in the alternative names, valid for 90 days.

The whole sequence took a matter of minutes after saving, not hours. Do not panic at stage 2.

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

As soon as https worked, the override had no job left. In `wp-config.php` I commented the two `define()` lines out (deleting them is just as good), confirmed Settings → General showed `https://` for both URLs, and loaded the admin over https.

Final checklist:

- `openssl s_client` shows a Let's Encrypt issuer and your domain in the subject or SAN.
- `curl -I` over https returns 200 without `-k`.
- `WP_HOME` and `WP_SITEURL` are removed or commented out in `wp-config.php`.
- Site URL and Home URL both read `https://` in Settings → General.
- Check the browser console for mixed content on a page with images.
- Close the support ticket if you opened one.

## Short version for Webreus users

- Let's Encrypt is switched on in the **Domain** tab of the website, with the SSL toggle on.
- It needs the **Power** package. On Allround the toggle is greyed out.
- After saving, wait a few minutes. A connection reset in between is normal.
- Check with `openssl s_client`, not with the panel's say-so, and keep the http override in `wp-config.php` only until it works.
