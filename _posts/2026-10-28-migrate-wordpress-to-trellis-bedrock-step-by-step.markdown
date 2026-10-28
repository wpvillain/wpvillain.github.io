---
layout: post
title: "Migrating a WordPress Site from Shared Hosting to Trellis and Bedrock: The Order That Works"
date: 2026-10-28 22:00:00 +0700
categories: wordpress trellis bedrock
tags: [wordpress, trellis, bedrock, migration, wp-cli, rsync, search-replace, devops]
case_category: devops
case_status: documented
---

Moving a site from shared hosting, Plesk or cPanel onto a [Trellis](https://roots.io/trellis/) server running [Bedrock](https://roots.io/bedrock/) is mostly a question of order. Each step is small. Doing them out of order is what produces a deployed site with an empty database, an uploads folder in the wrong place, or URLs that still say `wp-content`.

This is the order I use, with the commands. Testing before the DNS switch and the cutover itself are in [the second part]({% post_url 2026-10-28-trellis-migration-test-etc-hosts-letsencrypt-dns-cutover %}).

## What changes

Bedrock moves WordPress out of the web root and renames the content directory:

```text
Traditional                       Bedrock
wp-content/themes/        ->      web/app/themes/
wp-content/plugins/       ->      web/app/plugins/
wp-content/uploads/       ->      web/app/uploads/
wp-config.php             ->      config/application.php + .env
wordpress core in root    ->      web/wp/ (installed by Composer)
```

Anything in your database that stores a `/wp-content/` URL will point at the old location until you rewrite it. That rewrite is step 8, and it is the one people forget.

You have two ways to deal with it. **Full Bedrock adoption** rewrites the database paths to `/app/...`. It is a few extra commands once and cleaner afterwards. **Path compatibility** keeps `/wp-content/` in the database and changes Bedrock's configuration to match. It saves the search-replace and costs you every time another developer opens the project and wonders why Bedrock does not look like Bedrock. I would only do it when something outside WordPress hard-codes the old paths.

## Two workflows

**Direct.** Provision the server, deploy an empty Bedrock, copy the database and uploads straight from the old host to the new server, convert paths, test, go live. Fewer steps, but the first time you see the site on the new server is also the first time it has to work.

**Local first.** Bring the database and uploads into the local Trellis VM, get it working at `https://example.test`, then push local to production with the database and files playbooks. More steps, but production stays untouched until the site already works, and you can repeat it as many times as needed.

I use local first whenever there is more than a trivial site, or more than one site. The rest of this post follows it and notes where direct differs.

## Before you start

- A fresh Ubuntu 22.04 or 24.04 server with SSH key access.
- A full backup of the old site: database export, themes, plugins, uploads, and a copy of `wp-config.php` for reference.
- A list of active plugins with versions, and any custom constants in `wp-config.php`.
- A look through the theme for hard-coded URLs and for `ABSPATH` or `wp-content` assumptions.
- The same PHP version on both sides, or at least a known difference.

## 1. Create the project locally

```bash
brew install roots/tap/trellis-cli
trellis new example.com
cd example.com
```

`trellis new` clones Trellis, clones Bedrock into `site/`, installs the Ansible Galaxy roles and initialises a Git repository.

Set real secrets before anything else. Edit the production vault and replace the generated salts and database password:

```bash
cd trellis
trellis vault edit production
```

Then start the local VM and check that Bedrock answers at `https://example.test`:

```bash
trellis vm start
```

Commit and push the project to GitHub or GitLab. Trellis deploys from Git, so the server needs a repository to clone.

## 2. Provision the server

Provision before you deploy. This installs Nginx, PHP, MariaDB and the rest, and creates `/srv/www/example.com/`:

```bash
cd trellis
trellis provision production
```

It takes 10 to 15 minutes. If it fails, check that you can SSH in as the provisioning user and that the server is a supported Ubuntu release.

## 3. Bring over the theme and plugins

Copy the theme into `site/web/app/themes/`. For plugins, install from Composer whenever a package exists:

```bash
cd site
composer require wpackagist-plugin/plugin-name
```

Plugins that are not on WordPress.org or WPackagist can go in `web/app/plugins/` and be committed, but each one you commit is one you now update by hand. Commit and push when the code is in place.

## 4. Deploy the empty site

```bash
cd trellis
trellis deploy production
```

If this is a second site on a server you already provisioned, **provision again first**. Adding a site to `wordpress_sites.yml` does not create its database, Nginx host or certificate until you do.

Deploy creates the release structure. Check it:

```bash
ssh admin_user@your.server.ip
ls -la /srv/www/example.com/               # current, releases, shared
ls -la /srv/www/example.com/current/web/app/   # uploads -> ../../../shared/uploads
```

The uploads symlink matters: uploads live in `shared/uploads`, outside any release, so they survive deploys. Do not import yet. The WordPress install screen is expected at this point.

## 5. Move the database

Export from the old host:

```bash
wp db export source-backup.sql --add-drop-table
```

Copy it to the server and import from the current release:

```bash
scp source-backup.sql admin_user@your.server.ip:/tmp/
ssh admin_user@your.server.ip
cd /srv/www/example.com/current
wp db import /tmp/source-backup.sql && rm /tmp/source-backup.sql
```

If WP-CLI is not on the old host, export with phpMyAdmin or `mysqldump`. Database credentials for the new site are in the `.env` file next to `current`.

With the local-first workflow you import into the VM instead, and later push it to production with the playbook, which also backs the remote database up first.

## 6. Move the uploads

Uploads go into `shared/uploads`, not into a release directory:

```bash
rsync -avz --progress /path/to/backup/wp-content/uploads/ \
  admin_user@your.server.ip:/srv/www/example.com/shared/uploads/

ssh admin_user@your.server.ip \
  "sudo chown -R web:www-data /srv/www/example.com/shared/uploads && \
   sudo chmod -R 775 /srv/www/example.com/shared/uploads"
```

`rsync` is resumable, which matters when the folder is several gigabytes. The ownership step is not optional: uploaded with the wrong owner, the files display but the next upload from the admin fails.

## 7. Rewrite the URLs and paths

First the domain, if it changes, then the Bedrock paths. Always with a dry run first:

```bash
cd /srv/www/example.com/current

wp search-replace 'http://old-domain.com' 'https://example.com' --all-tables --dry-run
wp search-replace 'http://old-domain.com' 'https://example.com' --all-tables

wp search-replace '/wp-content/themes/' '/app/themes/' --all-tables --dry-run
wp search-replace '/wp-content/themes/' '/app/themes/' --all-tables

wp search-replace 'https://example.com/wp-content/uploads/' \
  'https://example.com/app/uploads/' --all-tables --precise --dry-run
wp search-replace 'https://example.com/wp-content/uploads/' \
  'https://example.com/app/uploads/' --all-tables --precise

wp search-replace '/wp-content/plugins/' '/app/plugins/' --all-tables
```

Also run the protocol-relative and plain-HTTP variants (`//example.com/wp-content/uploads/`, `http://example.com/...`) so nothing is left behind. `--precise` makes the replace slower and safer on serialized data, and page builders store a lot of that.

Then flush and rebuild:

```bash
wp cache flush
wp rewrite flush
wp media regenerate --yes   # only if thumbnails are missing
```

The flags and the multisite variants are covered in [wp search-replace for domain, HTTPS and Bedrock path migrations]({% post_url 2026-10-28-wp-search-replace-wordpress-url-domain-https-bedrock-paths %}).

If you chose path compatibility instead, skip the rewrite and keep Bedrock's content URL and directory pointing at `wp-content`. Nginx can also redirect old `/wp-content/` URLs to the new location so external links keep working.

## 8. Check the site

```bash
wp core is-installed
wp plugin list
wp theme list
wp option get home
```

Then use it. Upload an image in the admin and confirm it lands in `shared/uploads`. Load the front end and watch the browser console for 404s and mixed-content warnings, and read the Nginx error log on the server.

## When something is wrong

| Symptom | Where I look first |
|---|---|
| Images missing | The `uploads` symlink target and ownership; leftover `/wp-content/` references (`wp db search`) |
| White screen | `WP_DEBUG` through `config/environments/production.php`, then the PHP-FPM log |
| Database connection error | Credentials in `.env`, that the database exists, that MariaDB is running |
| Permalinks 404 | `wp rewrite flush`, then the Nginx site config |
| Theme or plugin breaks | Hard-coded `wp-content` paths or `ABSPATH` assumptions in its code |
| Mixed content | A missed `http://` variant of the search-replace |

The next step is the part that decides whether launch day is calm: [testing against the real domain before DNS, then cutting over]({% post_url 2026-10-28-trellis-migration-test-etc-hosts-letsencrypt-dns-cutover %}).

---

*Migrated a site this way and hit something I did not list? Find me on Mastodon at [@jfrumau@mastodon.social](https://mastodon.social/@jfrumau).*
