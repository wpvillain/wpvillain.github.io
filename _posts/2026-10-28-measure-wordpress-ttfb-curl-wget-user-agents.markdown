---
layout: post
title: "Measuring WordPress TTFB From the Command Line: curl, wget, and Why to Test as Googlebot Too"
date: 2026-10-28 18:00:00 +0700
categories: wordpress performance devops
tags: [wordpress, ttfb, performance, curl, wget, caching, bash]
case_category: performance
case_status: documented
---

Time to First Byte is the number I check first when a WordPress site feels slow. It needs no browser, no Lighthouse run and no account, only `curl` and a URL. It also tells you whether the problem sits on the server or in the front end, which decides where you spend the next hour.

## What counts as good

Google's [web.dev guidance on TTFB](https://web.dev/articles/ttfb) puts it like this: TTFB comes before First Contentful Paint and Largest Contentful Paint, so a slow server response caps every metric after it. The rough thresholds:

| TTFB | Rating |
|---|---|
| 0.8 s or less | Good |
| 0.8 to 1.8 s | Needs improvement |
| Over 1.8 s | Poor |

These are targets for the 75th percentile of real visitors. One curl run from your laptop is a sample, not a verdict.

## One curl command

```bash
curl -w "\nTTFB: %{time_starttransfer}s\n" -o /dev/null -s -D - https://example.com
```

`-o /dev/null` throws the body away, `-s` hides the progress meter, `-D -` prints the response headers to the terminal, and `-w` appends the timing. You get the headers and the number in one go:

```
HTTP/2 200
content-type: text/html; charset=UTF-8
x-litespeed-cache: hit
server: LiteSpeed

TTFB: 0.762227s
```

The headers matter as much as the number. A `x-litespeed-cache: hit` or an `x-cache` header tells you whether you measured the page cache or PHP. Measuring a cache hit and calling the site fast is how slow uncached pages stay hidden.

To see where the time goes, ask curl for each phase:

```bash
curl -o /dev/null -s -w "dns %{time_namelookup}s  connect %{time_connect}s  tls %{time_appconnect}s  ttfb %{time_starttransfer}s  total %{time_total}s\n" https://example.com
```

If `dns`, `connect` and `tls` are small and `ttfb` is large, the server is spending the time building the page. If the first three are large, you are looking at the network path or the TLS setup, not WordPress.

## wget as a second opinion

`wget` has no timing variable, but it is often installed where `curl` is not:

```bash
wget --server-response --spider --timeout=30 https://example.com 2>&1 | grep -E "(HTTP|Length|time)"
```

For a rough total, wrap it in `time`:

```bash
time wget --spider --quiet https://example.com
```

That is total request time rather than TTFB, so use it as a sanity check only.

## Run it more than once

The first request after a cache purge is slow, the next ones are fast, and any single number is noisy. I run five requests and average them. I wrote that into a script in [wp-ops](https://github.com/imagewize/wp-ops), which also prints DNS, connect and SSL timings and rates the result against the thresholds above:

```bash
wp-ops ttfb-test https://example.com
```

It runs from your machine, so your own distance to the server is part of the result. For the server's own view, run the request on the server over SSH. The second script does that, and it does it once per URL for four user agents: the default, Googlebot, AhrefsBot and Screaming Frog:

```bash
wp-ops remote-ttfb-ua web@example.com https://example.com/ https://example.com/blog/
```

## Why test as a bot

A WAF, a rate limiter or a cache rule can treat crawlers differently from visitors. A cache that keys on a cookie bots never send, or a bot-protection layer that challenges unknown user agents, will serve visitors cached pages while crawlers get the uncached path. Every manual check in your browser looks fast, and the slowness only shows up in Search Console's crawl stats.

If the default user agent is fast and the bot user agents are not, look at cache bypass rules and bot-protection settings before you touch PHP.

## What to do with the number

- **Cache hit, fast:** the server side is fine. Look at images, scripts and fonts next.
- **Cache hit, slow:** a network or TLS problem, or an overloaded server. Check the `connect` and `tls` phases.
- **Cache miss, slow:** PHP and the database are the cost. Object caching, a lighter plugin set and PHP-FPM worker settings are the levers.
- **Fast for visitors, slow for bots:** a cache or WAF rule, as above.

The broader checklist of what to change once you know the server is the problem is in [WordPress Speed Optimization Guide 2025](https://wpvilla.in/wordpress-speed-optimization-guide-2025/).

---

*Measured something odd with these commands? Find me on Mastodon at [@jfrumau@mastodon.social](https://mastodon.social/@jfrumau).*
