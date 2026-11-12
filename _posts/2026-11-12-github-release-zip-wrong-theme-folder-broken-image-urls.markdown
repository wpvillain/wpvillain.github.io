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

I also downloaded the previous release (1.2.9) and listed it. The first entries are `screenshot.png`, `readme.txt`, `CHANGELOG.md`, `theme.json`, `style.css`, with no `mytheme/` in front. Nothing had gone wrong in the build. It produced the zip I asked it to; I never looked at the top level of the zip, because WordPress had always accepted it.

## What I saw

The theme's release workflow zipped the repo with `zip -r ... -x@.distignore`, run from the repo root. That puts `style.css`, `theme.json` and the rest at the **top level of the zip**, with no folder around them.

Uploading that zip in wp-admin (Appearance, Themes, Add New, Upload) installed the theme in `wp-content/themes/mytheme-7UDAiHTr2pvX4XAZ`. Not `mytheme`. The zip does not contain that string. I listed it: no entry has `7UDA` in it, and the only folders are `assets`, `languages`, `parts`, `patterns`, `styles` and `templates`, all at the top level. WordPress made the name during the upload.

WordPress 7.1.4 added this to `wp-admin/includes/class-wp-upgrader.php`:

```php
/**
 * Builds an unpredictable name for the directory a package is unpacked into.
 *
 * @since 7.1.4
 */
private function get_working_dir_name( $package ) {
    $name = basename( basename( $package, '.tmp' ), '.zip' );
    return $name . '-' . wp_generate_password( 16, false );
}
```

So an upload is unpacked into `wp-content/upgrade/mytheme-` plus 16 random characters. What happens next depends on the zip:

- **One top-level folder:** that folder becomes the theme folder, and the random working directory is thrown away. You never see the suffix.
- **A flat zip:** there is no folder to take, so the working directory itself becomes the theme folder, random suffix and all.

That also explains why this never bit me before. In WordPress 6.7.2, which I had locally, the working directory was just the zip name without `.zip`. A flat `mytheme.zip` installed as `mytheme`, which is exactly what you want, so the flat zip went unnoticed. 7.1.4 hardened the directory name, and this site was the first time I installed one of these zips on 7.1.4.

So the flat zip was a mistake waiting to happen, and the 7.1.4 change set it off. Neither GitHub nor WordPress did anything wrong.

Everything still looked fine in the browser, which is why I missed it:

- The theme activated and rendered.
- The header and footer template parts hard-code `"theme":"mytheme"` in their block comments. With the active stylesheet named `mytheme-7UDAiHTr2pvX4XAZ`, those references could not match.

## The second mistake, on top of the first

Before I noticed the folder, I built the home page from the theme's home pattern. The pattern prints its images with `get_theme_file_uri( 'assets/images/hero.webp' )`. When you insert a pattern in the editor, that function runs once and the **result is saved into the page content as a plain absolute URL**:

```html
<img src="https://example.nl/wp-content/themes/mytheme-7UDAiHTr2pvX4XAZ/assets/images/hero.webp" alt="...">
```

Later I renamed the folder to `mytheme` over FTP and re-uploaded the corrected theme. Every file was in the right place, but the page still held the old URL. In the browser's console:

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
unzip -l mytheme.zip | head
# mytheme/assets/images/hero.webp  ...
```

Every path starts with `mytheme/`. That is the check I would repeat after any change to a release workflow.

## The fix in the database, step by step

The old folder name appeared only in the page content, so one query on the posts table was enough. The host had no SSH, so I used the phpMyAdmin that Webreus provides. Getting into it took one wrong turn, so here is the whole path.

**1. Find the right phpMyAdmin.** On Webreus each hosting account lives on a numbered server, and each server has its own phpMyAdmin at `https://srvNNNNNN.webreus.net/phpmyadmin/`. I first logged in on the server of another site I manage there. The login failed, because the database user does not exist on that server. The site's own server shows up in DNS:

```bash
IP=$(dig +short example.nl | tail -n 1)
dig +short -x "$IP"
```

The first line stores the site's IP address in a variable (`tail -n 1` keeps the last line, in case the domain answers with an alias first). The second does a reverse lookup of that address, and the answer has the form `srvNNNNNN.webreus.net`. That is the server name. On that server the login worked.

**2. Take the login from `wp-config.php`.** `DB_USER` and `DB_PASSWORD` are the phpMyAdmin credentials, and `DB_NAME` is the database to pick in the left column. `$table_prefix` is the table prefix, which was not the default `wp_` here. Do not paste that file, or a screenshot of it, into a chat or a ticket. The password of this database ended up in a conversation while I worked on this, so I rotated it afterwards.

**3. Export the whole database first.** I used the Export tab with the Quick method and kept the `.sql` file. Then I searched the dump for the old folder name before changing anything:

```bash
grep -c 'mytheme-7UDAiHTr2pvX4XAZ' backup.sql
awk '/^INSERT INTO/{t=$3} /mytheme-7UDAiHTr2pvX4XAZ/{print t}' backup.sql | sort | uniq -c
```

The second command prints which table each hit sits in. It showed two lines, both in the posts table, so nothing else needed a change.

**4. Run the replacement** on the SQL tab, with your own prefix:

```sql
UPDATE prefix_posts
SET post_content = REPLACE(post_content, 'mytheme-7UDAiHTr2pvX4XAZ', 'mytheme')
WHERE post_content LIKE '%mytheme-7UDAiHTr2pvX4XAZ%';
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

- **Other WordPress versions.** I read the source of 6.7.2 and 7.1.4 and saw the result on 7.1.4. I did not check the versions in between, so I do not know if 7.1.4 is the first with the random name beyond its `@since` tag.
- **Whether the suffix changes on every upload.** The source says it does (`wp_generate_password()` on every unpack); I uploaded once.
- **Installing the zip any other way**, such as `wp theme install` or Composer. I only know the wp-admin upload route.
- **Other places the old URL could live**, such as theme mods, widgets or serialized options. In this database the dump showed none, but a different site could have them.
- **The `admin-ajax.php` 403** on this host. I do not know the rule behind it or whether it is fixed.

If your site also had an HTTPS or maintenance-mode problem during the same build, the [maintenance mode mu-plugin write-up]({% post_url 2026-11-11-wordpress-maintenance-mode-mu-plugin-503-logged-in-users %}) and the [Let's Encrypt write-up]({% post_url 2026-11-11-shared-hosting-lets-encrypt-greyed-out-wp-config-http-override-openssl-check %}) come from the same project.
