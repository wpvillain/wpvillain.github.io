---
layout: post
title: "Cloning an Existing Trellis and Bedrock Project and Getting It Running Locally: Vault Password, VM, Provision, Pull from Production"
date: 2026-10-29 09:30:00 +0700
categories: wordpress trellis bedrock
tags: [wordpress, trellis, bedrock, lima, ansible-vault, composer, vite, sage, devops]
case_category: devops
case_status: documented
---

You have a Trellis and Bedrock project in a Git repository and a Mac that is [ready for Trellis]({% post_url 2026-10-29-new-mac-trellis-development-setup-lima-composer-node %}). The steps between `git clone` and a working site at `https://yourproject.test` are always the same, and the failures are always in the same few places: a premium plugin that needs credentials, a missing vault password, and a database that arrives with production URLs.

Commands below use `admin_user` for the admin username set in `group_vars/all/users.yml`.

## 1. Clone

```bash
cd ~/code
git clone git@github.com:YOUR_ORG/your-project.git
cd your-project
```

A project of this kind looks like:

```text
your-project/
├── site/                # Bedrock
│   ├── composer.json
│   ├── config/
│   └── web/
│       ├── app/themes/your-theme/   # Sage theme
│       └── wp/                      # WordPress core, managed by Composer
└── trellis/
    ├── group_vars/
    └── trellis.yml
```

## 2. Install PHP dependencies

If the project uses a premium plugin from a private Composer repository, Composer needs credentials first. For ACF Pro, create `site/auth.json`:

```json
{
  "http-basic": {
    "connect.advancedcustomfields.com": {
      "username": "YOUR_ACF_LICENSE_KEY",
      "password": "http://YOUR_SITE_URL"
    }
  }
}
```

It must be in `.gitignore`. Then:

```bash
cd site
composer install
```

That installs WordPress core, the Composer-managed plugins and Bedrock's own dependencies into `vendor/`.

## 3. Install the theme dependencies

```bash
cd web/app/themes/your-theme
pnpm install     # or npm install
```

This is Vite and the theme framework, in `node_modules/`. Several hundred megabytes is normal.

## 4. Environment files

Bedrock reads `site/.env`:

```bash
cd site
cp .env.example .env
```

```env
DB_NAME='your_project_dev'
DB_USER='example_dbuser'
DB_PASSWORD='example_dbpassword'
WP_ENV='development'
WP_HOME='http://yourproject.test'
WP_SITEURL="${WP_HOME}/wp"
```

Add salts from `roots.io/salts.html`. Trellis reads its own development settings from `trellis/group_vars/development/wordpress_sites.yml`, and it is usually already right. The one value to know about is `local_path: ../site`, the path to the Bedrock install.

## 5. Initialise Trellis and add the vault password

```bash
cd trellis
trellis init
```

`trellis init` creates a Python virtualenv and installs Ansible into it. It takes a few minutes the first time.

Provisioning decrypts the vault files, so it needs `.vault_pass`. On an existing project, copy it from a machine that already has it, through a password manager and never through Git:

```bash
echo "PASTE_PASSWORD_HERE" > .vault_pass
chmod 600 .vault_pass
```

Every team member needs this file. If you are starting a brand-new project instead, generate one and re-encrypt the vault files:

```bash
echo "$(openssl rand -base64 32)" > .vault_pass
chmod 600 .vault_pass
```

## 6. Start the VM and provision

```bash
trellis vm start
```

That creates a Lima VM with Ubuntu, mounts the project and adds the site hosts to `/etc/hosts`. The first run takes a few minutes. Check the hosts entry:

```bash
grep yourproject.test /etc/hosts
```

If it is missing, add it with the VM's IP. Then provision:

```bash
trellis provision development
```

The first provision takes 10 to 15 minutes. It installs the LEMP stack, creates the Nginx host, PHP-FPM pool, database and a self-signed certificate, and installs WordPress with WP-CLI. Open `https://yourproject.test`. A self-signed certificate warns once: in Safari use Show Details and visit the site, in Chrome use Advanced and proceed, or type `thisisunsafe` on the warning page.

## 7. Real content: pull from production

A fresh install is empty. To work against real content, use the production pull. With the database and files playbooks:

```bash
cd trellis
ansible-playbook database-backup.yml -e env=development -e site=yourproject.com   # safety copy
ansible-playbook database-pull.yml   -e env=production  -e site=yourproject.com
ansible-playbook files-pull.yml      -e env=production  -e site=yourproject.com
```

I explain what the database pull does step by step in [the database-pull post](https://wpvilla.in/trellis-database-pull-playbook-explained/), and the daily version is in [refreshing local from production](https://wpvilla.in/refresh-local-wordpress-from-production-wp-ops/).

If the playbooks fail because of the port 3306 conflict, do the same thing from inside the VM:

```bash
trellis vm shell --workdir /srv/www/yourproject.com/current -- bash -c "
wp db export /tmp/dev_backup_\$(date +%Y%m%d_%H%M%S).sql.gz --path=web/wp
ssh web@yourproject.com 'cd /srv/www/yourproject.com/current && wp db export - --path=web/wp' | gzip > /tmp/prod_import.sql.gz
gunzip < /tmp/prod_import.sql.gz | wp db import - --path=web/wp
wp search-replace 'https://yourproject.com' 'http://yourproject.test' --all-tables --precise --path=web/wp
wp cache flush --path=web/wp
"
```

Match the replacement to your local scheme. Check `WP_HOME` in `site/.env`: `http://` if the local site is plain HTTP, `https://` if you enabled the self-signed certificate.

**Multisite** needs the replace across the whole network, because a `UPDATE` on two tables leaves serialized content and the other subsites pointing at production:

```bash
wp search-replace 'yourproject.com' 'yourproject.test' --network --path=web/wp
wp site list --path=web/wp
wp cache flush --network --path=web/wp
```

For the uploads, `rsync` works too, after you add the production host key (see below):

```bash
rsync -avz web@yourproject.com:/srv/www/yourproject.com/shared/uploads/ site/web/app/uploads/
```

## 8. Theme development

```bash
cd site/web/app/themes/your-theme
pnpm dev
```

Vite serves with hot reload at `http://localhost:3000` and proxies to the site. Before deploying, build the assets:

```bash
pnpm build
```

That writes versioned files into `public/build/`.

## Production access and deploy

Add your public key to the production user's `authorized_keys` (or to `users.yml` and provision), then deploy from the Trellis directory:

```bash
trellis deploy production
```

## Daily commands

```bash
trellis vm start                 # morning
trellis vm stop                  # save resources
trellis vm delete                # fresh start
trellis vm shell --workdir /srv/www/yourproject.com/current -- wp plugin list --path=web/wp
```

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Changes do not appear | Usually the WordPress cache, not sync: `trellis vm shell -- wp cache flush --path=/srv/www/yourproject.com/current/web/wp`, then a hard refresh; restart Vite for CSS and JS |
| Playbooks fail with SSH errors | Port 3306 conflict with a host database; run WP-CLI in the VM |
| Browser says the connection is not private | Self-signed certificate; expected locally |
| `trellis vm start` hangs | `limactl list`, then `trellis vm delete` and start again |
| 500 after a database pull | The theme's Composer and npm dependencies are missing or assets are unbuilt: `composer install`, `npm install`, `npm run build` in the theme |
| WP-CLI: "Error locating autoloader" | The same: run `composer install` in the theme directory |
| `rsync` or `files-pull` fails: "Host key verification failed" | `ssh-keyscan -H yourproject.com >> ~/.ssh/known_hosts`, then retry |
| Composer memory error | `php -d memory_limit=-1 $(which composer) install` |

## Check it worked

- `trellis vm status` shows the VM running
- `curl -I http://yourproject.test` returns 200
- The admin loads and `wp option get home` shows the local URL
- The theme builds with `pnpm build`

---

*Run into a step I skipped? Find me on Mastodon at [@jfrumau@mastodon.social](https://mastodon.social/@jfrumau).*
