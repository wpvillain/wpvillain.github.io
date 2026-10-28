---
layout: post
title: "Browser Caching Headers on Trellis With One Global Nginx Include (and Why Long Expiry Needs Versioned Assets)"
date: 2026-10-29 12:30:00 +0700
categories: wordpress trellis nginx
tags: [wordpress, trellis, nginx, caching, expires, performance, devops]
case_category: performance
case_status: documented
---

PageSpeed's "serve static assets with an efficient cache policy" warning has a boring fix: tell the browser it may keep images, fonts, CSS and JS for a long time. On Trellis that is one file in a directory that applies to every site on the server.

## Where it goes

Trellis reads includes from two kinds of folder in your project:

| In your Trellis project | On the server | For |
|---|---|---|
| `nginx-includes/all/` | `/etc/nginx/includes.d/all/` | Everything every site wants: caching, security headers |
| `nginx-includes/<site key>/` | `/etc/nginx/includes.d/<site key>/` | One site, named like its key in `wordpress_sites.yml` |

There is no `nginx_includes` setting in `wordpress_sites.yml`; the folders are the whole mechanism. Put the caching file in `all/`. Save this as `trellis/nginx-includes/all/assets-expiry.conf.j2`:

```nginx
# SVG first, so it takes precedence over the general static block
location ~* \.svg$ {
    add_header Content-Security-Policy "default-src 'self'";
    expires 1y;
    add_header Cache-Control "public, no-transform";
    add_header Vary Accept;
    access_log off;
    etag on;
    try_files $uri =404;
}

# Images and fonts
location ~* \.(jpg|jpeg|png|gif|ico|webp|avif|eot|ttf|woff|woff2|otf)$ {
    try_files $uri =404;
    expires 1y;
    add_header Cache-Control "public, no-transform";
    add_header Vary Accept;
    access_log off;
    etag on;
}

# CSS and JS
location ~* \.(css|js)$ {
    try_files $uri =404;
    expires 1y;
    add_header Cache-Control "public, no-transform";
    add_header Vary Accept;
    access_log off;
    etag on;
}

# WordPress minified assets and emoji script
location ~* /wp-content/.*\.(min\.(css|js)|wp-emoji-release\.min\.js)$ {
    try_files $uri =404;
    expires 1y;
    add_header Cache-Control "public, no-transform";
}
```

Deploy it:

```bash
trellis provision --tags nginx-includes production
```

HTML and PHP are not matched by any of these blocks, so they keep whatever your PHP-FPM and cache plugin send. That is the point: assets are cached hard, pages are not.

## One year is only safe with versioned URLs

`expires 1y` means a browser will not even ask again for a year. That is fine for `style.css?ver=1.4.2` or a hashed build file, because a new release changes the URL. It is wrong for a file that is replaced in place under the same name, such as `/app/uploads/logo.png` swapped for a new logo. Returning visitors will keep the old one.

WordPress adds `?ver=` to enqueued scripts and styles, and Sage builds hashed file names, so theme assets are covered. Uploads are the ones to think about. If you replace images in place, shorten the image block (for example `expires 30d;`) or give the new file a new name.

## Check the headers

```bash
curl -I https://example.com/app/themes/mytheme/public/build/assets/app-4f3a9c.css
```

```
Expires: Thu, 28 Oct 2027 06:39:38 GMT
Cache-Control: max-age=31536000
Cache-Control: public, no-transform
Vary: Accept
```

There are two `Cache-Control` lines: `expires` writes the first and `add_header` the second. Browsers combine them.

Run it for a CSS, an image and a font. In DevTools, the Network tab shows the same under Response Headers; a reload that shows `(disk cache)` or `(memory cache)` means it worked.

If the headers are missing, in order: is the file really in `nginx-includes/all/`, did you provision with `--tags nginx-includes`, and does `sudo nginx -t` pass on the server. If you changed durations and nothing moved, check for a CDN or a caching plugin adding its own headers on top.

## Two things to watch

- **Vary: Accept on everything.** The include adds it to CSS and JS too, though only images change by `Accept`. It is harmless for browsers, but it can make a CDN keep several copies of the same stylesheet. If that matters, delete the line from the CSS and JS blocks.
- **Overlap with the WebP include.** The image block here and the one in [the WebP and AVIF include]({% post_url 2026-10-29-serve-webp-avif-nginx-trellis-accept-header-bedrock-uploads %}) both match `.jpg`, and the first matching regex location wins. Files in `all/` are read alphabetically, so the WebP file is named `00-webp-avif.conf.j2` to come before `assets-expiry.conf.j2`. With the names the other way round, the images are cached but never negotiated; I tested that case too. Keep the `00-` prefix if you rename anything.
