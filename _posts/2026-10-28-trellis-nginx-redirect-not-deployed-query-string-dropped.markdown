---
layout: post
title: "My Trellis Nginx Redirect Did Nothing: The Wrong Provision Tag, and a 301 That Drops the Query String"
date: 2026-10-28 17:30:00 +0700
categories: wordpress trellis nginx
tags: [wordpress, trellis, nginx, redirects, seo, 301, ansible, devops]
case_category: debugging
case_status: shipped
---

I moved a blog post to another domain and added a 301 for the old URL to the site's Nginx redirect file in Trellis. I committed it, ran a provision, and the old URL still returned 200. The provision had finished without an error.

Two things went wrong in that one redirect, and I only noticed the second because I tested it properly.

## 1. The tag skipped the file

The redirect lives in `trellis/nginx-includes/example.com/seo-redirects.conf.j2`, and I had provisioned with `--tags nginx`. That tag runs the `nginx` role. The per-site include files are templated by the `wordpress-setup` role, so the run completed and the file was never written.

You can see this from the server. The `web` user can read the deployed includes:

```bash
ssh web@example.com "ls -la --time-style=full-iso /etc/nginx/includes.d/example.com/"
ssh web@example.com "grep -c 'new-destination' /etc/nginx/includes.d/example.com/seo-redirects.conf"
```

The timestamp was two days old and the count was 0. Compare that with a local file that has the rule: the repo was ahead of the server.

The tags that do deploy them:

```bash
trellis provision --tags nginx-includes production
# or, with the rest of the site setup:
trellis provision --tags wordpress-setup production
```

I ran the second one, with `letsencrypt` alongside it, and the redirect went live. `nginx-includes` is the narrow tag for this job.

## 2. The query string disappears

With the redirect live, I tested it with a campaign parameter:

```bash
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' 'https://example.com/old-post/?utm_source=x'
```

It returned the 301 and a destination with no `?utm_source=x`. The rule was:

```nginx
location = /old-post/ {
    return 301 https://other.example/new-post/;
}
```

`return` does not carry the query string over. (`rewrite` does, which is where the idea comes from.) A few guides, including my own notes until today, say that query strings are preserved automatically. For a redirect that people reach from a newsletter or an ad, that loses the tracking.

If the query should survive, append it:

```nginx
location = /old-post/ {
    return 301 https://other.example/new-post/$is_args$args;
}
```

I left it off for this one, because the destination is a different site and I did not want the old site's parameters on it. Decide per redirect.

## The rule pair that gives a single hop

An exact `location =` match is slash-sensitive, so I write both forms:

```nginx
location = /old-post/ {
    return 301 https://other.example/new-post/;
}
location = /old-post {
    return 301 https://other.example/new-post/;
}
```

Before the rule was deployed, the no-slash URL did not 404 or fall through. WordPress's own canonical redirect sent it to the slash version, and only then did the slash rule apply. With both forms present, each URL goes straight to the destination in one hop:

```bash
curl -sIL -o /dev/null -w 'hops=%{num_redirects} final=%{url_effective}\n' https://example.com/old-post
```

I got `hops=1`.

## A short checklist that would have caught this

1. Provision with `nginx-includes` or `wordpress-setup`, not `nginx`.
2. Check the deployed file on the server (timestamp and a `grep` for the new rule), before blaming the cache.
3. Test with a cache-busting parameter (`?x=123`), so a cached page cannot be what answers. An exact-match rule ignores the query string, so the parameter does not stop the rule from matching.
4. Test both slash forms, with and without a query string, and count the hops.
5. Point every redirect at the final destination, never at another redirect.

Afterwards, deal with the old page. I moved the post, so the original still exists in WordPress. Trash it or set it to noindex, so it leaves the sitemap and cannot be served if the redirect is ever removed.
