---
layout: post
title: "Migrating Several WordPress Sites onto One Trellis Server: Configure Everything First, and the Pitfalls That Bite"
date: 2026-10-28 23:00:00 +0700
categories: wordpress trellis bedrock
tags: [wordpress, trellis, bedrock, migration, multiple-sites, ansible, devops]
case_category: devops
case_status: documented
---

Trellis can host many WordPress sites on one server, and moving three sites over is not three times the work of moving one. Most of the first migration is learning; the second and third reuse it. What makes them go smoothly, or not, is mostly setup: one project, unique names, and every site configured before the first provision.

This builds on [the single-site migration]({% post_url 2026-10-28-migrate-wordpress-to-trellis-bedrock-step-by-step %}). Here are the parts that change when there is more than one site, and the mistakes that cost me time.

## One project, one directory per site

`trellis new example.com` creates `trellis/` and a `site/` directory for the Bedrock install. Rename `site/` straight away to something that says which site it is, because the next site needs its own:

```text
example.com/
├── trellis/
├── site-example/        # Bedrock for example.com
├── site-clienttwo/      # Bedrock for clienttwo.com
└── site-clientthree/    # Bedrock for clientthree.com
```

Point each site at its directory in `trellis/group_vars/<environment>/wordpress_sites.yml`:

```yaml
wordpress_sites:
  example.com:
    site_hosts:
      - canonical: example.com
    local_path: ../site-example
    repo: git@github.com:yourname/trellis-multi.git
    repo_subtree_path: site-example

  clienttwo.com:
    site_hosts:
      - canonical: clienttwo.com
    local_path: ../site-clienttwo
    repo: git@github.com:yourname/trellis-multi.git
    repo_subtree_path: site-clienttwo
```

All sites share one Trellis configuration and, in this layout, one Git repository. `repo_subtree_path` tells Trellis which folder of that repository holds each site.

To add a Bedrock install for another site, create it next to the others:

```bash
composer create-project roots/bedrock site-clienttwo
```

Do the same in both the development and production `wordpress_sites.yml`, and in both vaults.

## Configure everything, then provision once

Add every site to `wordpress_sites.yml` **before the first provision**. One run then creates all the databases, Nginx hosts and certificates:

```bash
cd trellis
trellis provision production
```

Adding a site later is fine, but it is a separate step: the new site has no database, no host and no directory until you provision again, and `trellis deploy` alone fails.

```bash
# add the site to wordpress_sites.yml, then:
trellis provision production
trellis deploy production clienttwo.com
```

`trellis deploy production` with no site name deploys all of them.

## Work the sites in parallel

The slow parts are transfers, and they do not depend on each other. Import the database for site one in one terminal, upload the uploads for site two in another, and prepare site three's theme in a third.

A folder per site for the old backups keeps this tidy:

```text
~/migrations/
├── example/        {database, files/uploads, files/themes, files/plugins}
├── clienttwo/
└── clientthree/
```

Two small scripts remove most of the repetition:

```bash
#!/bin/bash
# migrate-uploads.sh <site-dir> <domain>
SITE=$1; DOMAIN=$2
SRC=~/migrations/$SITE/files/uploads
DEST=/srv/www/$DOMAIN/shared/uploads
rsync -avz --progress "$SRC"/ admin@your.server.ip:"$DEST"/
ssh admin@your.server.ip "sudo chown -R web:www-data $DEST && sudo chmod -R 775 $DEST"
```

```bash
#!/bin/bash
# import-database.sh <site-dir> <domain>
SITE=$1; DOMAIN=$2
scp ~/migrations/$SITE/database/backup.sql admin@your.server.ip:/tmp/backup-$SITE.sql
ssh admin@your.server.ip "cd /srv/www/$DOMAIN/current && wp db import /tmp/backup-$SITE.sql && rm /tmp/backup-$SITE.sql"
```

If you push from the local VM instead, use the database and files push playbooks, which take the remote backup before they overwrite anything.

## Pitfalls

**1. The same `local_path` for every site.** Copy a site block and forget to change the path, and deploys fail or ship the wrong site's code. Check them all:

```bash
grep -A5 "local_path" group_vars/production/wordpress_sites.yml
```

**2. The same `repo_subtree_path`.** Same symptom, different cause: the deploy checks out the wrong folder of the repository. Each site needs its own.

**3. Reused database passwords and salts.** Copying the vault block between sites copies the password and the salts. One compromised site then exposes the others. Generate a password per site, and fetch fresh salts for each, in both vaults.

**4. Not re-provisioning after adding a site.** Database connection errors, a 502 from Nginx, a missing certificate, or `/srv/www/newsite.com/` not existing all mean the same thing. Provision, then deploy.

**5. Updating only one environment.** The development and production files and vaults both need the new site, or `trellis vm` and production disagree.

**6. A wrong branch name.** The `branch:` in the site config must match what your repository actually uses (`main` or `master`). Check with `git branch -a`.

**7. Skipping the path conversions on later sites.** Each site needs its own `/wp-content/` to `/app/` search-replace and a check for leftovers:

```bash
wp db search '/wp-content/' --all-tables
```

It should return nothing.

**8. Upload permissions.** Files copied as your own user are not writable by the web user. After every uploads transfer, `chown -R web:www-data` and `chmod -R 775` on `shared/uploads`.

**9. DNS TTL.** Lower it 24 to 48 hours ahead and keep the old server running afterwards. See [the cutover post]({% post_url 2026-10-28-trellis-migration-test-etc-hosts-letsencrypt-dns-cutover %}).

**10. Pushing over a production database by accident.** Take a manual export first, then run the push. The playbook also backs up the remote database to `database_backup/` automatically, but confirm the file exists before you rely on it.

## Which site is that database?

When something looks wrong on one site, find out which database it is using before you change anything:

```bash
ssh admin_user@your.server.ip
cd /srv/www/clienttwo.com/current
grep DB_NAME .env
wp --path=web/wp db tables | head
```

And to run WP-CLI for a specific site from anywhere on the server, give it that site's path:

```bash
wp --path=/srv/www/clienttwo.com/current/web/wp plugin list
```

## When not to share a server

Separate servers make sense when the sites have very different traffic, need different PHP versions, have security or regulatory isolation requirements, or when one of them is mission-critical and should not compete for memory with the others. Watch RAM and PHP-FPM as sites are added; [this post]({% post_url 2025-11-24-debugging-php-fpm-memory-exhaustion-wordpress-woocommerce-trellis %}) covers what it looks like when you run out.

## Before sites two and three

For each site, check that it has:

- A unique `local_path` and `repo_subtree_path`
- A unique database password and unique salts in the vault
- The right branch name
- Both development and production config updated
- Uploads permissions set after transfer
- Path conversions verified with `wp db search`
- A lowered DNS TTL and a tested local copy

---

*Running many sites on one Trellis box and doing it differently? Find me on Mastodon at [@jfrumau@mastodon.social](https://mastodon.social/@jfrumau).*
