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

The rule is about the file name: `photo.jpg` is replaced by `photo.jpg.webp` or `photo.jpg.avif`, the **original name plus the new extension**, not `photo.webp`.

## The include

Save this as `trellis/nginx-includes/webp-avf.conf.j2`:

```nginx
map $http_accept $webp_suffix {
    default "";
    "~*image/webp" ".webp";
}

map $http_accept $avif_suffix {
    default "";
    "~*image/avif" ".avif";
}

location ~* ^/app/uploads/(.*)\.(jpg|jpeg|png)$ {
    root {{ www_root }}/{{ site.name }}/current/web;

    set $img_path /app/uploads/$1;

    if (-f $document_root${img_path}${avif_suffix}) {
        add_header Vary Accept;
        rewrite ^ $img_path$avif_suffix break;
    }

    if (-f $document_root${img_path}${webp_suffix}) {
        add_header Vary Accept;
        rewrite ^ $img_path$webp_suffix break;
    }

    try_files $uri =404;
}
```

Things worth knowing about it:

- **`/app/uploads/` is the Bedrock uploads path.** On a classic WordPress layout it would be `/wp-content/uploads/`. Change both the regex and `$img_path`.
- **AVIF is checked before WebP**, so a browser that accepts both gets the smaller AVIF when it exists.
- **`Vary: Accept`** tells caches (CDNs, browsers) that the same URL can return different bytes depending on the header. Without it, a cache can hand a WebP to a browser that cannot show one.
- If neither converted file exists, `try_files $uri =404` serves the original.
- It is a `.conf.j2`, so `{{ www_root }}` and `{{ site.name }}` are filled in by Trellis.

## Wire it into the site

In `trellis/group_vars/production/wordpress_sites.yml`:

```yaml
wordpress_sites:
  example.com:
    # ...
    nginx_includes:
      - nginx-includes/webp-avf.conf.j2
```

Then deploy only the includes:

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
curl -H "Accept: image/webp" -I https://example.com/app/uploads/2026/10/photo.jpg
```

You want `Content-Type: image/webp` and `Vary: Accept`. Then without the header:

```bash
curl -I https://example.com/app/uploads/2026/10/photo.jpg
```

That should still say `image/jpeg`. If you get the JPG for the first request, check that `photo.jpg.webp` exists with exactly that name, and that no other `location` is catching the image first. Two regex locations that match the same URL are resolved by order in the config, and a caching include with its own image rule can win. That is the next post's subject: [browser caching headers for Trellis]({% post_url 2026-10-29-nginx-browser-caching-headers-trellis-all-includes-expires %}).
