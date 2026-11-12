---
layout: post
title: "A Flat Release Zip Gave My WordPress Theme a Random Folder Name, and Broke Every Image URL Built From It"
date: 2026-11-12 20:00:00 +0700
categories: wordpress devops
tags: [wordpress, github-actions, block-themes, release, troubleshooting, shared-hosting, webreus, phpmyadmin]
case_category: devops
case_status: documented
---

I released a block theme from GitHub, uploaded the zip through wp-admin on a client's shared host at Webreus.nl (a Dutch host with no SSH on this plan), and the theme worked. A day later the home page had three broken images and the console said 404 for each. The files were on the server. The page was asking for them in a folder that no longer existed.

The cause was one line in a GitHub Actions workflow. Here is the chain, the fix in the workflow, and how I repaired the page content in phpMyAdmin afterwards.

## Where the line came from

I went back through the history to find out why a theme I had released many times behaved like this only now. The answer is in the first commit. The theme was created from a starter theme through GitHub's template repository feature, and the workflow came with it, unchanged since then:

```yaml
- name: Zip Folder
  run: zip -r ${{ github.event.repository.name }}.zip . -x@.distignore
```

`git log` on the workflow file shows two commits in the new repo: the initial one with exactly that line, and the fix from this week. The starter theme's own repo has the same line, and so do several of my other theme and plugin repos. Only one of them already wrapped its files in a folder, because its WordPress.org review asked for a clean zip.

I also downloaded the previous release (1.2.9) and listed it. The first entries are `screenshot.png`, `readme.txt`, `CHANGELOG.md`, `theme.json`, `style.css`, with no `ecotuin/` in front. Nothing had gone wrong in the build. It produced the zip I asked it to; I never looked at the top level of the zip, because WordPress had always accepted it.

## What I saw

The theme's release workflow zipped the repo with `zip -r ... -x@.distignore`, run from the repo root. That puts `style.css`, `theme.json` and the rest at the **top level of the zip**, with no folder around them.

Uploading that zip in wp-admin (Appearance, Themes, Add New, Upload) installed the theme in `wp-content/themes/ecotuin-7UDAiHTr2pvX4XAZ`. Not `ecotuin`. WordPress takes the folder name from the zip's top-level directory. With nothing to take, the folder is named after the uploaded file, and that file name is a temporary one with a random part. That is where `7UDAiHTr2pvX4XAZ` came from: it is not a hash of anything, just the random part of the temp name.

I checked this against the core source of the WordPress 6.7.2 copy I had locally (`wp-admin/includes/class-wp-upgrader.php`), not 7.1.4 where I saw it:

- `unpack_package()` makes a working directory named after the package file, with `.tmp` and `.zip` stripped.
- `install_package()` looks at what is inside it. If there is exactly one entry and it is a folder, that folder becomes the theme. If there are several entries (a flat zip), the working directory itself becomes the source.
- The theme folder name is then the name of the source, so a flat zip gives a folder named after the temp file.

I did not trace where the upload code creates the temp name, and I did not rerun it on 7.1.4. It matched what I saw: the same name appeared as `ecotuin-` plus 16 random characters.

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

## The fix in the database, step by step

The old folder name appeared only in the page content, so one query on the posts table was enough. The host had no SSH, so I used the phpMyAdmin that Webreus provides. Getting into it took one wrong turn, so here is the whole path.

**1. Find the right phpMyAdmin.** On Webreus each hosting account lives on a numbered server, and each server has its own phpMyAdmin at `https://srvNNNNNN.webreus.net/phpmyadmin/`. I first logged in on the server of another site I manage there. The login failed, because the database user does not exist on that server. The site's own server shows up in DNS:

```bash
dig +short example.nl
dig +short -x 203.0.113.10   # the IP from the first command; the answer is srvNNNNNN.webreus.net
```

The reverse lookup of the site's IP gave the server name. On that server the login worked.

**2. Take the login from `wp-config.php`.** `DB_USER` and `DB_PASSWORD` are the phpMyAdmin credentials, and `DB_NAME` is the database to pick in the left column. `$table_prefix` is the table prefix, which was not the default `wp_` here. Do not paste that file, or a screenshot of it, into a chat or a ticket. The password of this database ended up in a conversation while I worked on this, so I rotated it afterwards.

**3. Export the whole database first.** I used the Export tab with the Quick method and kept the `.sql` file. Then I searched the dump for the old folder name before changing anything:

```bash
grep -c 'ecotuin-7UDAiHTr2pvX4XAZ' backup.sql
awk '/^INSERT INTO/{t=$3} /ecotuin-7UDAiHTr2pvX4XAZ/{print t}' backup.sql | sort | uniq -c
```

The second command prints which table each hit sits in. It showed two lines, both in the posts table, so nothing else needed a change.

**4. Run the replacement** on the SQL tab, with your own prefix:

```sql
UPDATE prefix_posts
SET post_content = REPLACE(post_content, 'ecotuin-7UDAiHTr2pvX4XAZ', 'ecotuin')
WHERE post_content LIKE '%ecotuin-7UDAiHTr2pvX4XAZ%';
```

phpMyAdmin reported "2 rows affected", which matched the two lines in the dump. A mismatch there is a reason to stop and look.

**5. Hard-refresh the page** (Cmd+Shift+R). The hero image, the logo and a third image loaded, and the console showed no more 404s.

If you only have one page to fix, there is a way without the database: open the page in the block editor, switch to the Code editor (Ctrl+Shift+Alt+M), replace the old folder name with the right one, and update. The SQL route is better when revisions or several pages carry the URL, or when you want to be sure nothing is missed.

A plain `REPLACE` is safe on post content because it is ordinary text. It is not safe on serialized data such as widget settings or some options, where a changed length breaks the value. With a shell, `wp search-replace 'old' 'new' --dry-run` handles serialized data correctly and is the better tool.

**A separate host problem I saw at the same time.** In the editor, the media library kept spinning and the console showed `POST /wp-admin/admin-ajax.php` returning 403. A logged-out request got the same 403, and my maintenance mu-plugin can only return 503, so the block sits in front of WordPress, most likely the host's firewall. I asked Webreus and have not confirmed a fix. It has nothing to do with the theme folder, but you may hit it on the same host while fixing this, so I list it here.

## What to take from it

- **Check the top level of a theme zip** before you ship it: `unzip -l theme.zip | head`. If the first path is `style.css`, the zip is flat.
- **Do not build pages from patterns until the theme folder name is final.** Anything that ran `get_theme_file_uri()` before a rename has the old name baked in.
- **A theme that "works" can still have the wrong folder name.** The visible signs are small: a hard-coded `"theme":"..."` value that no longer matches, and URLs that contain the wrong slug.

## What I did not test

- **Other WordPress versions.** I saw this on 7.1.4 and read the source of 6.7.2. I did not test other versions.
- **Whether the suffix changes on every upload.** I uploaded once, so I assume it does, because it comes from a temp file name.
- **Installing the zip any other way**, such as `wp theme install` or Composer. I only know the wp-admin upload route.
- **Other places the old URL could live**, such as theme mods, widgets or serialized options. In this database the dump showed none, but a different site could have them.
- **The `admin-ajax.php` 403** on this host. I do not know the rule behind it or whether it is fixed.

If your site also had an HTTPS or maintenance-mode problem during the same build, the [maintenance mode mu-plugin write-up]({% post_url 2026-11-11-wordpress-maintenance-mode-mu-plugin-503-logged-in-users %}) and the [Let's Encrypt write-up]({% post_url 2026-11-11-shared-hosting-lets-encrypt-greyed-out-wp-config-http-override-openssl-check %}) come from the same project.
