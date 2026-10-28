---
layout: post
title: "Which Analytics Is This WordPress Site Running? Detect Site Kit, GA4, GTM and Matomo With curl"
date: 2026-10-28 18:30:00 +0700
categories: wordpress analytics devops
tags: [wordpress, analytics, google-analytics, google-tag-manager, matomo, site-kit, curl, bash]
case_category: devops
case_status: documented
---

{% raw %}
When you take over a WordPress site, one of the first questions is what tracking it already has. The answer is rarely in the handover notes, and the admin screens only show what a plugin knows about itself. The page source shows what visitors actually get, and `curl` plus `grep` reads it in a second.

## Site Kit

Google's Site Kit plugin leaves meta tags in the head:

```bash
curl -sL https://example.com | grep -E 'googlesitekit|gtagconfig'
```

```
<meta name="googlesitekit-setup" content="abc123-def4-567g-8hij-klmnopqrstuv" />
<meta name="generator" content="Site Kit by Google 1.150.0" />
```

The generator tag also gives you the plugin version, which is handy when you are deciding whether an update is overdue. Site Kit installs the Analytics tag for you, so a hit here usually means a hit in the next check as well.

## Google Analytics

```bash
curl -sL https://example.com | grep -E 'gtag\(|googletagmanager|analytics\.js|GA_MEASUREMENT_ID'
```

A GA4 install loads `gtag/js?id=G-...` from `googletagmanager.com`. The older Universal Analytics used `analytics.js`; if you see that on a site today, the tag is dead, because Universal Analytics stopped processing data in 2023.

Many themes also add a DNS prefetch for the Google tag host, which is a second signal:

```bash
curl -sL https://example.com | grep -E 'dns-prefetch.*googletagmanager'
```

```
<link rel='dns-prefetch' href='//www.googletagmanager.com' />
```

A prefetch without a tag means someone removed the tag and left the hint behind.

## Google Tag Manager

GTM is its own check, because the container can hold GA4, ads pixels and anything else:

```bash
curl -sL https://example.com | grep -E 'googletagmanager\.com/gtm\.js\?id=GTM-'
```

```
<script src="https://www.googletagmanager.com/gtm.js?id=GTM-XXXXXXX"></script>
```

If this matches, `grep` for GA4 will tell you nothing about what is really firing. The container ID is what you open in the GTM interface.

## Matomo

Matomo has three footprints, depending on how it is hosted:

```bash
# self-hosted tracking script
curl -sL https://example.com | grep -E 'matomo\.js|piwik\.js|_paq\.push'

# Matomo Cloud
curl -sL https://example.com | grep -E 'cdn\.matomo\.cloud'

# tracking pixel (the no-JavaScript fallback)
curl -sL https://example.com | grep -E 'matomo\.php\?|piwik\.php\?'
```

```
<script src="https://analytics.example.com/matomo.js"></script>
var _paq = window._paq = window._paq || [];
<script src="https://cdn.matomo.cloud/example.matomo.cloud/matomo.js"></script>
```

Older installs still say `piwik`, which is what Matomo was called before 2011.

## All of it in one script

```bash
#!/bin/bash

DOMAIN="example.com"
HTML=$(curl -sL "https://$DOMAIN")

echo "=== Analytics detection for $DOMAIN ==="

echo "1. Google Site Kit"
echo "$HTML" | grep -E 'googlesitekit|Site Kit by Google' | head -3

echo "2. Google Analytics"
echo "$HTML" | grep -E 'gtag\(|googletagmanager|GA_MEASUREMENT_ID' | head -3

echo "3. Google Tag Manager"
echo "$HTML" | grep -E 'googletagmanager\.com/gtm\.js\?id=GTM-' | head -3

echo "4. Matomo"
echo "$HTML" | grep -E 'matomo\.js|piwik\.js|_paq\.push|cdn\.matomo\.cloud' | head -3

echo "5. Other trackers"
echo "$HTML" | grep -E 'facebook\.net/.*fbevents|hotjar\.com|segment\.com' | head -3
```

I fetch the page once into a variable instead of calling `curl` five times, so the checks all look at the same response and the site only sees one request.

## What this cannot see

- **Consent-gated tags.** Many sites inject the tracking script only after a visitor accepts cookies. `curl` never accepts, so it sees nothing. Open the site in a browser, accept, and check the Network tab.
- **Tags added by GTM.** The container is visible, its contents are not.
- **Server-side tracking.** There is nothing in the page to find.
- **Pages other than the homepage.** A tag can be added to a landing page or a checkout only. Run the check against the URLs that matter.

A hit tells you the code is on the page. It does not tell you data is arriving. For that, use the Realtime report, Google's Tag Assistant or the browser's Network tab filtered on `collect` or `matomo.php`.

## Common faults once you find the tags

1. **Two tags firing.** Site Kit plus a hard-coded `gtag` snippet in the theme, or GA4 both directly and inside GTM, double-counts every pageview. Count the matches rather than just checking for one.
2. **Tag present, no data.** A measurement ID from the wrong property, or a script error earlier on the page. Check the browser console.
3. **Plugin conflicts.** Two analytics plugins active at once. Deactivate all but one while testing.

## Privacy and performance notes

Analytics scripts are the usual reason a consent banner is needed. Matomo can run without cookies and with anonymised IPs, which is why it is often chosen where the rules are strict, but your legal basis is for you to confirm, not this post.

On performance, load the script asynchronously and keep the DNS prefetch for the Google tag host.

---

*Found a tracker this misses? Find me on Mastodon at [@jfrumau@mastodon.social](https://mastodon.social/@jfrumau).*
{% endraw %}
