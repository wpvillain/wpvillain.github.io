---
layout: post
title: "Serve WebP and AVIF from Nginx on Trellis Without Touching the HTML: Accept-Header Negotiation for Bedrock Uploads"
date: 2026-10-29 12:00:00 +0700
categories: wordpress trellis nginx
tags: [wordpress, trellis, nginx, webp, avif, performance, bedrock, images, devops]
case_category: performance
case_status: documented
---

There are two ways to get WebP onto a WordPress site. One rewrites the HTML, so every `<img>` points at a `.webp`. The other leaves the HTML alone and lets the server decide per request. On a Trellis server the second is a small Nginx include, and it has one nice property: the original JPG stays the URL everywhere, so share cards, feeds, RSS readers and old browsers keep working.

## The idea

A browser that can show WebP says so in its `Accept` header (`image/webp`, and `image/avif` for AVIF). Nginx looks at that header, and if a converted file sits next to the original it serves that instead. If not, the original is served. The URL does not change.

The rule is about the file name: `photo.jpg` is replaced by `photo.jpg.webp` or `photo.jpg.avif`, the **original name plus the new extension**, not `photo.webp`. (My first version of this include looked for `photo.webp`, so the commands below would have produced files it never served.)

## The include

Save this as `trellis/nginx-includes/all/00-webp-avif.conf.j2`:

```nginx
location ~* ^/app/uploads/.+\.(jpg|jpeg|png)$ {
    expires 1y;
    add_header Vary Accept;

    set $avif_suffix ".none";
    set $webp_suffix ".none";
    if ($http_accept ~* "image/avif") { set $avif_suffix ".avif"; }
    if ($http_accept ~* "image/webp") { set $webp_suffix ".webp"; }

    if (-f $document_root$uri$avif_suffix) {
        rewrite ^ $uri$avif_suffix break;
    }
    if (-f $document_root$uri$webp_suffix) {
        rewrite ^ $uri$webp_suffix break;
    }

    try_files $uri =404;
}
```

Four details here come from how Trellis loads includes, and I got each of them wrong the first time I wrote this up:

- **It lives in `all/`, with a `00-` prefix.** Trellis reads includes inside each site's `server` block, `all/` first, then the site's own folder. Files in a folder are read alphabetically. When two regex locations match the same URL, the first one in the config wins. A caching include with its own `\.(jpg|png)$` block (like [the one in the next post]({% post_url 2026-10-29-nginx-browser-caching-headers-trellis-all-includes-expires %})) would win and the images would never be negotiated. `00-` makes this file come first. That is also why it sets `expires 1y` itself: the caching block never sees these requests.
- **`set` and `if`, not `map`.** `map` is only allowed in the `http` block. In an include inside `server` it makes `nginx -t` fail with `"map" directive is not allowed here`. `set` and `if` are allowed in a location.
- **`.none` is a placeholder that never exists.** If the suffix were empty, `$document_root$uri` would be the original file, the `-f` test would pass and the original would be served before WebP is considered.
- **AVIF is checked before WebP**, so a browser that accepts both gets the AVIF when it exists, and falls back to WebP when it does not.

`/app/uploads/` is the Bedrock uploads path. On a classic layout it would be `/wp-content/uploads/`.

`Vary: Accept` tells caches (CDNs, browsers) that one URL can return different bytes depending on the header. Without it a cache can hand a WebP to a browser that cannot show one.

## Deploy it

There is nothing to add to `wordpress_sites.yml`. Trellis has no `nginx_includes` setting; it copies every `*.conf.j2` from `nginx-includes/all/` (every site) and from `nginx-includes/<site key>/` (one site, named like the key in `wordpress_sites.yml`). The `.j2` is dropped on the server, so this ends up as `/etc/nginx/includes.d/all/00-webp-avif.conf`.

```bash
trellis provision --tags nginx-includes production
```

Try it on the VM first (`trellis provision development`, then `trellis vm shell -- sudo nginx -t`). A syntax mistake in an include is much cheaper to find there. If the provision seems to do nothing, [the tag post]({% post_url 2026-10-28-trellis-nginx-redirect-not-deployed-query-string-dropped %}) is about exactly that failure.

## Make the converted files

The include only serves; something has to create the files.

```bash
# One image
cwebp -q 80 photo.jpg -o photo.jpg.webp
cavif --quality 80 photo.jpg

# Everything under uploads/
find uploads/ -name "*.jpg" -exec cwebp -q 80 {} -o {}.webp \;
```

`brew install webp cavif` on macOS, `apt-get install webp` on Ubuntu. Quality 75 to 85 suits photos and 85 to 95 suits images with text. Keep the originals: they are the fallback.

A plugin that writes `.jpg.webp` next to the original works with the same include. WebP Express, EWWW Image Optimizer and ShortPixel can all do that. Check what file name the plugin actually writes before assuming it matches.

If you instead want WebP in the page but a JPG in the share card, that is a different trick: [WebP featured images without breaking og:image]({% post_url 2026-10-28-wordpress-webp-featured-images-og-image-original-jpg %}).

## Check it

```bash
curl -sI -H "Accept: image/webp,*/*" https://example.com/app/uploads/2026/10/photo.jpg
```

You want `Content-Type: image/webp`, `Vary: Accept` and a `Cache-Control: max-age=31536000`. Then without the header:

```bash
curl -sI -H "Accept: text/html" https://example.com/app/uploads/2026/10/photo.jpg
```

That should still say `image/jpeg`.

I tested the include against a local Nginx with a caching include next to it. With both `photo.jpg.avif` and `photo.jpg.webp` present, `Accept: image/avif,image/webp` returned AVIF and `Accept: image/webp` returned WebP. With only a WebP, a browser asking for both got WebP. With neither, everyone got the JPG.

If you get the JPG when a converted file exists, check in this order: that the file is named exactly `photo.jpg.webp`, that the include is `00-webp-avif.conf.j2` in `nginx-includes/all/` and was deployed (`ls /etc/nginx/includes.d/all/`), and that no other regex `location` for images is read earlier.
