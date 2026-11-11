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

What the command does, piece by piece:

- **`echo |`** feeds an empty line into `openssl s_client`, which otherwise waits for input and never exits.
- **`openssl s_client -connect example.nl:443`** opens a TLS connection to the site on the https port and prints what the server presents.
- **`-servername example.nl`** sends the hostname during the handshake (SNI). It matters: without it you get the server's default certificate, not the one for your domain. On shared hosting that default is the hoster's own certificate.
- **`2>/dev/null`** hides the connection chatter on stderr, so only the certificate comes through the pipe.
- **`| openssl x509`** reads that certificate and prints selected fields. **`-noout`** suppresses the raw certificate text, and **`-issuer`**, **`-subject`** and **`-dates`** print who issued it, which hostname it is for, and its start and end dates.

Three stages showed up:

1. **The shared host certificate.** Subject the hosting company's own domain. No certificate for our domain yet, and `curl -I https://example.nl/` failed with "no alternative certificate subject name matches".
2. **A connection reset.** `curl` returned "Recv failure: Connection reset by peer" and `openssl` printed "Could not find or decode certificate". This was the server reloading the vhost while it applied the change. It looks alarming, but it was progress.
3. **The Let's Encrypt certificate.** Issuer Let's Encrypt, subject `*.example.nl` with `example.nl` in the alternative names, valid for 90 days.

The whole sequence took a matter of minutes after saving, not hours. Do not panic at stage 2.

## Verify the way a browser would, without -k

Once the certificate looked right, I checked it end to end:

```bash
curl -sS -I https://example.nl/wp-login.php
```

The curl flags here:

- **`-s`** (silent) hides the progress meter, and **`-S`** (show errors) brings error messages back, so `-sS` means quiet output where a failure such as "connection reset" still prints.
- **`-I`** sends a HEAD request and prints only the response headers, which is enough to see the status code.
- **`-k`** (insecure) tells curl to skip certificate verification. I do not use it here. Its absence is the point: without `-k`, curl only succeeds if the certificate is valid for the host.

HTTP 200 with no `-k` means curl trusted the certificate chain. At that moment Chrome still showed a certificate warning for the same URL. When the command line verifies and the browser does not, believe the command line first, then restart the browser or use a private window before touching the server again. Also confirm DNS for both the bare domain and `www` points at the right IP:

```bash
dig +short example.nl www.example.nl
```

`dig` asks DNS for the records of the names you give it, and `+short` prints just the answer, here the IP address for each name.

## Check for mixed content

A valid certificate does not mean every resource loads over https. Images, scripts or stylesheets with a hard-coded `http://` URL get blocked or flagged by the browser. A quick first pass is to grep the served HTML for them:

```bash
curl -sSL https://example.nl/ \
  | grep -o -i -E "(src|href|action|poster|data-src|srcset)=[\"']http://[^\"' ]+" \
  | grep -v -E "w3\.org|schema\.org" | sort -u
```

The flags: `curl -L` follows redirects (so `www` or http redirects end up at the real page), and in `grep`, `-o` prints only the matching part, `-i` ignores case, `-E` uses extended regular expressions, and `-v` in the second grep drops lines that match (here the harmless `w3.org` and `schema.org` namespace links). `sort -u` removes duplicates.

No output means no `http://` resources in that page's HTML. It does not catch resources that CSS or JavaScript load later, so also open the page with the browser console and look for "Mixed Content" messages. If the grep finds your own domain, fix it with `wp search-replace 'http://example.nl' 'https://example.nl' --all-tables --precise` (dry run first). Repeat for a few key pages, not just the home page.

## A firewall can look like a broken certificate

An hour after the certificate went live, every request from my machine started failing again: `curl` returned "Connection reset by peer" and Chrome showed `ERR_CONNECTION_RESET`. That looked like the certificate problem coming back, but it was not.

What gave it away:

- **Plain http reset too**, and so did port 80 with an unrelated `Host:` header. A certificate problem cannot break that.
- **A browser user agent, `--http1.1` and no SNI changed nothing.** The reset happens before any HTTP is exchanged, so a user-agent filter is ruled out.
- **Ping and ssh still answered**, and other domains on the same hoster loaded fine from the same connection.

That pattern points at a firewall or brute-force protection dropping traffic from one IP, not at the site. I had been probing `/wp-login.php` with `curl` a few times, and my VPN exit IP was not on the site's allow list. After that IP was added in the hosting panel's security tab, the site was reachable again. I cannot prove the probes were the trigger, so treat that as the likely cause, not a fact.

If you get resets on a shared host, test from a different network first (mobile data is the quickest). If it loads there, your IP is blocked, and the fix is the allow list, not the certificate. Allow lists in this panel are per site, so an IP you added for one domain does not cover another. And space out your probe requests to the login page.

## Clean up the override

As soon as https worked, the override had no job left. In `wp-config.php` I commented the two `define()` lines out (deleting them is just as good), confirmed Settings → General showed `https://` for both URLs, and loaded the admin over https.

Final checklist:

- `openssl s_client` shows a Let's Encrypt issuer and your domain in the subject or SAN.
- `curl -I` over https returns 200 without `-k`.
- `WP_HOME` and `WP_SITEURL` are removed or commented out in `wp-config.php`.
- Site URL and Home URL both read `https://` in Settings → General.
- Grep the HTML for `http://` resources and check the browser console for mixed content on a page with images.
- Close the support ticket if you opened one.

## Short version for Webreus users

- Let's Encrypt is switched on in the **Domain** tab of the website, with the SSL toggle on.
- It needs the **Power** package. On Allround the toggle is greyed out.
- After saving, wait a few minutes. A connection reset in between is normal.
- Check with `openssl s_client`, not with the panel's say-so, and keep the http override in `wp-config.php` only until it works.
