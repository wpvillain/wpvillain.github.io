---
layout: post
title: "A 25-Line WordPress Maintenance Mode mu-plugin: 503, noindex, Logged-In Users Only"
date: 2026-11-11 12:00:00 +0700
categories: wordpress devops
tags: [wordpress, mu-plugin, maintenance-mode, seo, rest-api, shared-hosting, troubleshooting]
case_category: devops
case_status: documented
---

A client site was built from a starter theme whose patterns still carried another site's text. The moment the theme went live, a logged-out visitor, or Google, would have seen a near-copy of a different business's homepage. Nobody should see that, so the site needed a "come back soon" page that only logged-in users bypass.

A maintenance plugin would do it, but on a shared host with FTP access and no shell, one small file is easier: a must-use plugin you upload once and delete at launch. This is the one I used, why each part is there, and what I checked on the live site.

## The plugin

Save it as `wp-content/mu-plugins/maintenance-mode.php`. Create the `mu-plugins` folder if it is missing. Must-use plugins load automatically, so there is nothing to activate.

```php
<?php
/**
 * Plugin Name: Maintenance mode
 * Description: Logged-out visitors get a 503 "under construction" page with noindex. Delete this file at launch.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

// Front end, feeds and sitemaps: logged-out visitors see the notice.
add_action(
	'template_redirect',
	function () {
		if ( is_user_logged_in() ) {
			return;
		}
		nocache_headers();
		header( 'Retry-After: 86400' );
		header( 'X-Robots-Tag: noindex, nofollow', true );
		wp_die(
			'<h1>Site name</h1><p>Our new website is under construction. Please come back soon.</p>',
			'Site name - under construction',
			array( 'response' => 503 )
		);
	},
	0
);

// REST API: keep page content private for logged-out requests.
add_filter(
	'rest_authentication_errors',
	function ( $result ) {
		if ( ! empty( $result ) || is_user_logged_in() ) {
			return $result;
		}
		return new WP_Error( 'rest_maintenance', 'Under construction.', array( 'status' => 503 ) );
	}
);
```

## Why each part is there

- **HTTP 503, not 200 or a redirect.** A 503 tells search engines the outage is temporary, so they keep whatever they already have instead of indexing the placeholder. `Retry-After` says when to come back, here 24 hours. A 302 to a holding page or a plain 200 would invite indexing the wrong thing.
- **`X-Robots-Tag: noindex, nofollow`** is a second safety net in case something caches or rewrites the status code.
- **`nocache_headers()`** keeps browsers from holding on to the notice after you launch.
- **Priority 0 on `template_redirect`** makes it run early. On the live site this covered pages, feeds and `/wp-sitemap.xml` alike; I did not dig into core to confirm the order of the sitemap handler, so test the sitemap URL on your own install.
- **The REST filter** is needed because `/wp-json/` does not go through `template_redirect`. Without it, anyone can read your page content at `/wp-json/wp/v2/pages` while the front end shows the notice.
- **`wp-login.php` and `wp-admin` are untouched.** They do not use `template_redirect` either, which is what you want: you and the client can still log in, and logged-in users see the real site.

## What I checked on the live site

After uploading the file over FTP I tested as a logged-out visitor with curl:

```bash
curl -sS -I https://example.nl/
curl -sS https://example.nl/wp-json/wp/v2/pages
curl -sS -o /dev/null -w "%{http_code}\n" https://example.nl/feed/
curl -sS -o /dev/null -w "%{http_code}\n" https://example.nl/wp-sitemap.xml
curl -sS -o /dev/null -w "%{http_code}\n" https://example.nl/wp-login.php
```

The curl flags, in case you do not use them every day:

- **`-s`** (silent) hides the progress meter, so only the result prints.
- **`-S`** (show errors) brings error messages back when `-s` is on. `-sS` together means quiet output, but a failure like "connection reset" still prints.
- **`-I`** sends a HEAD request and prints only the response headers, which is what you want for the status code, `retry-after` and `x-robots-tag`.
- **`-o /dev/null`** sends the response body to nowhere. I use it when I only care about the status code, not the HTML.
- **`-w "%{http_code}\n"`** (write-out) prints a value after the transfer. Here it prints the HTTP status code and a newline, so `-o /dev/null -w "%{http_code}\n"` gives a clean one-line result per URL.

What came back:

- The home page returned `HTTP/2 503` with `retry-after: 86400` and `x-robots-tag: noindex, nofollow`.
- `/wp-json/wp/v2/pages` returned the `rest_maintenance` error with status 503.
- `/feed/` and `/wp-sitemap.xml` both returned 503.
- `/wp-login.php` returned 200.

It still returned 503 after I activated a different theme and set a page with the theme's home pattern as the front page. The behavior does not depend on the theme, since it runs as a must-use plugin.

## What I did not test

- **Page caching and CDNs.** If a cache plugin or CDN is in front of the site, it could serve a cached page to logged-out visitors, or cache the 503. I did not have one on this host. If you do, purge the cache after adding and after removing the file.
- **WP-CLI.** `template_redirect` does not run in CLI requests, so WP-CLI is not affected, which is usually what you want.
- **Allow-listing specific IPs or clients** who should see the site without logging in. This version only checks the login state.

## Launch

Delete the file. That is the whole off switch, and it is also the reason a one-file mu-plugin is a good fit: there is no setting to forget, and nothing left behind in the database. After deleting it, run the same curl checks and expect 200.

If you used this together with an https change on the same host, see [the Let's Encrypt and firewall write-up]({% post_url 2026-11-11-shared-hosting-lets-encrypt-greyed-out-wp-config-http-override-openssl-check %}).
