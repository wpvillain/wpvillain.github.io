---
layout: post
title: "A Flat Release Zip Gave My WordPress Theme a Random Folder Name, and Broke Every Image URL Built From It"
date: 2026-11-12 20:00:00 +0700
categories: wordpress devops
tags: [wordpress, github-actions, block-themes, release, troubleshooting, shared-hosting, phpmyadmin]
case_category: devops
case_status: documented
---

I released a block theme from GitHub, uploaded the zip through wp-admin on a client's shared host, and the theme worked. Two days later the home page had three broken images and the console said 404 for each. The files were on the server. The page was asking for them in a folder that no longer existed.

The cause was one line in a GitHub Actions workflow. Here is the chain, the fix, and how I repaired the page content afterwards.

## What I saw

The theme's release workflow zipped the repo with `zip -r ... -x@.distignore`, run from the repo root. That puts `style.css`, `theme.json` and the rest at the **top level of the zip**, with no folder around them.

Uploading that zip in wp-admin (Appearance, Themes, Add New, Upload) installed the theme in `wp-content/themes/ecotuin-7UDAiHTr2pvX4XAZ`. Not `ecotuin`. WordPress takes the folder name from the zip's top-level directory. With nothing to take, it fell back to a name made from the file name plus a random suffix. That is what I saw on WordPress 7.1.4; I did not read core to see exactly where the suffix comes from.

Everything still looked fine in the browser, which is why I missed it:

- The theme activated and rendered.
- The header and footer template parts hard-code `"theme":"ecotuin"` in their block comments. With the active stylesheet named `ecotuin-7UDAiHTr2pvX4XAZ`, those references could not match.

## The second mistake, on top of the first

Before I noticed the folder, I built the home page from the theme's home pattern. The pattern prints its images with `get_theme_file_uri( 'assets/images/hero.webp' )`. When you insert a pattern in the editor, that function runs once and the **result is saved into the page content as a plain absolute URL**:

```html
<img src="https://example.nl/wp-content/themes/ecotuin-7UDAiHTr2pvX4XAZ/assets/images/hero.webp" alt="...">
```

Later I renamed the folder to `ecotuin` over FTP and re-uploaded the corrected theme. Every file was in the right place, but the page still held the old URL. In the browser's console:

```
Failed to load resource: the server responded with a status of 404 ()   hero.webp:1
```

and the page showed the alt text where the hero photo should have been. A request for the right file in the right folder returned 200 and the same byte count as the repo copy. Only the saved URL was stale.

## The fix in the workflow

Wrap the files in one folder named after the repository, so the zip's top level is the theme folder:

```yaml
- name: Zip Folder
  env:
    NAME: ${{ github.event.repository.name }}
  run: |
    zip -qr "$RUNNER_TEMP/flat.zip" . -x@.distignore
    mkdir -p "$RUNNER_TEMP/pkg/$NAME"
    unzip -q "$RUNNER_TEMP/flat.zip" -d "$RUNNER_TEMP/pkg/$NAME"
    (cd "$RUNNER_TEMP/pkg" && zip -qr "$GITHUB_WORKSPACE/$NAME.zip" "$NAME")
```

It builds the same file list as before (the `.distignore` still applies), then re-zips it inside `$NAME/`. I checked it by listing the released zip, not just by trusting the YAML:

```bash
unzip -l ecotuin.zip | head
# ecotuin/assets/images/hero.webp  ...
```

Every path starts with `ecotuin/`. That is the check I would repeat after any change to a release workflow.

## The fix in the database

The old folder name appeared only in the page content, so one query on the posts table was enough. I did this in phpMyAdmin because the host had no SSH. The order matters:

1. **Export the whole database first.** I used the Export tab with the Quick method. I searched the dump for the old folder name before touching anything: it appeared in two rows of the posts table and nowhere else, so no other table needed a change.
2. **Run the replacement** (table prefix here is `wp_`, yours may differ):

```sql
UPDATE wp_posts
SET post_content = REPLACE(post_content, 'ecotuin-7UDAiHTr2pvX4XAZ', 'ecotuin')
WHERE post_content LIKE '%ecotuin-7UDAiHTr2pvX4XAZ%';
```

phpMyAdmin reported 2 rows affected, which matched the two lines in the dump.

3. **Hard-refresh the page.** The images loaded.

A plain `REPLACE` is safe on post content because it is ordinary text. It is not safe on serialized data such as widget settings or some options, where a changed length breaks the value. If you have a shell, `wp search-replace 'old' 'new' --dry-run` handles serialized data correctly and is the better tool.

## What to take from it

- **Check the top level of a theme zip** before you ship it: `unzip -l theme.zip | head`. If the first path is `style.css`, the zip is flat.
- **Do not build pages from patterns until the theme folder name is final.** Anything that ran `get_theme_file_uri()` before a rename has the old name baked in.
- **A theme that "works" can still have the wrong folder name.** The visible signs are small: a hard-coded `"theme":"..."` value that no longer matches, and URLs that contain the wrong slug.

## What I did not test

- **Other WordPress versions.** I only saw this on 7.1.4. I did not test how older versions name the folder for a flat zip.
- **Whether the suffix is random on every upload** or only on the first. I uploaded once.
- **Installing the zip any other way**, such as `wp theme install` or Composer. I only know the wp-admin upload route.
- **Other places the old URL could live**, such as theme mods, widgets or serialized options. In this database the dump showed none, but a different site could have them.

If your site also had an HTTPS or maintenance-mode problem during the same build, the [maintenance mode mu-plugin write-up]({% post_url 2026-11-11-wordpress-maintenance-mode-mu-plugin-503-logged-in-users %}) and the [Let's Encrypt write-up]({% post_url 2026-11-11-shared-hosting-lets-encrypt-greyed-out-wp-config-http-override-openssl-check %}) come from the same project.
