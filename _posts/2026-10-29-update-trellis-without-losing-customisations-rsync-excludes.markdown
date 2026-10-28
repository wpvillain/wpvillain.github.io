---
layout: post
title: "Updating Trellis Without Losing Your Vault, Site Config and Custom Roles: A Backup, Diff and rsync-with-Excludes Routine"
date: 2026-10-29 10:00:00 +0700
categories: wordpress trellis ansible
tags: [wordpress, trellis, ansible, rsync, vault, devops, upgrade, galaxy]
case_category: devops
case_status: documented
---

Trellis lives inside your project, not as a dependency, so there is no `composer update` for it. The `trellis/` directory is a copy of the upstream repository that you have customised: a vault password, site definitions, PHP settings, SMTP credentials, extra playbooks and Nginx includes. Updating means getting the new upstream files without overwriting any of that.

This is the routine I use. It is a backup, a diff to see what would change, then an `rsync` with explicit excludes. The excluded list is the useful part, because it is the inventory of what you have customised.

## Back up and look first

```bash
mkdir -p ~/trellis-backup
cp -ra ~/code/website.com/trellis/ ~/trellis-backup/

mkdir -p ~/trellis-temp && cd ~/trellis-temp
git clone git@github.com:roots/trellis.git
```

Compare the fresh clone with your copy and save the file-level differences:

```bash
mkdir -p ~/trellis-diff
diff -rq ~/trellis-temp/trellis/ ~/code/website.com/trellis/ > ~/trellis-diff/changes.txt
```

Remove the clone's `.git` directory so the copy cannot pull its repository metadata into your project:

```bash
rm -rf ~/trellis-temp/trellis/.git
```

## rsync with excludes

```bash
rsync -av \
  --exclude=".vault_pass" \
  --exclude="ansible.cfg" \
  --exclude=".trellis/" \
  --exclude=".git/" \
  --exclude=".github/" \
  --exclude="group_vars/*/vault.yml" \
  --exclude="group_vars/*/wordpress_sites.yml" \
  --exclude="group_vars/all/users.yml" \
  --exclude="group_vars/all/main.yml" \
  --exclude="group_vars/*/main.yml" \
  --exclude="group_vars/all/mail.yml" \
  --exclude="hosts/" \
  --exclude="trellis.cli.yml" \
  --exclude="deploy-hooks/" \
  --exclude="nginx-includes/" \
  --exclude="docs/" \
  ~/trellis-temp/trellis/ ~/code/website.com/trellis/
```

This is the shape. Your list depends on what you added. The groups I protect:

| What | Files |
|---|---|
| Secrets | `.vault_pass`, `ansible.cfg`, every `group_vars/*/vault.yml` |
| Git and CI | `.git/`, `.github/`, `.trellis/` |
| Site definitions | every `wordpress_sites.yml`, `group_vars/all/users.yml`, `hosts/`, `trellis.cli.yml` |
| Server settings | `group_vars/*/main.yml` (PHP memory limits, timezone, PHP-FPM pool, MariaDB) |
| SMTP | `group_vars/all/mail.yml` |
| Custom deploy and playbooks | `deploy-hooks/`, any database and files playbooks you added |
| Nginx | `nginx-includes/`, plus a patched `nginx.conf.j2` if you have one |
| Your own docs | `docs/`, your changelog |

**`ansible.cfg` is the critical one.** It holds the `vault_password_file` setting. Overwrite it and the next provision fails with "Attempting to decrypt but no vault secrets found".

If you have patched a role's task or template, exclude that file too and re-apply the change deliberately, because the next step will tell you whether upstream touched it.

Then clean up and check:

```bash
rm -rf ~/trellis-temp
cd ~/code/website.com
git status
git diff trellis/
```

## Review what changed

`changes.txt` shows which files differ. `git diff trellis/` shows the lines. Look for:

- **New roles**, such as a `redis` role appearing in a later version.
- **Changed defaults** in `roles/*/defaults/main.yml`.
- **Templates you customised**, which `rsync` just overwrote if you did not exclude them. Check these by name:

```bash
git diff trellis/roles/mariadb/templates/50-server.cnf.j2
git diff trellis/roles/wordpress-setup/templates/php-fpm-pool-wordpress.conf.j2
git diff trellis/roles/nginx/templates/nginx.conf.j2
```

If you had set `max_allowed_packet` or `max_connections` in the MariaDB template, or changed the PHP-FPM pool, re-apply them. A cleaner long-term answer is to move such settings into `group_vars` variables, which the roles already read, so they survive the next update.

Also check `requirements.txt` and `CHANGELOG.md` for new Ansible requirements. Recent Trellis versions work with ansible-core 2.10 or newer:

```bash
ansible --version
```

## Update the Galaxy roles

```bash
cd ~/code/website.com/trellis
ansible-galaxy install -r galaxy.yml --force
```

`--force` matters. Without it Galaxy keeps the roles it already downloaded.

## Test before you commit

Provisioning development is the full test, and it takes a while. A quick check that the stack still answers is often enough first:

```bash
trellis vm shell --workdir /srv/www/website.com/current -- wp --version --path=web/wp
trellis vm shell --workdir /srv/www/website.com/current -- wp db check --path=web/wp
```

Then `trellis provision development` before production.

## Commit

```bash
git add trellis/
git commit -m "Update Trellis to the latest upstream

Preserve vault, site config, PHP and SMTP settings, deploy hooks and Nginx includes.
Update Galaxy roles. Tested in the development VM."
```

## When the vault is not found afterwards

If `trellis provision` says it cannot decrypt, check the three things the update could have touched:

```bash
ls -la trellis/.vault_pass
grep vault_password_file trellis/ansible.cfg      # vault_password_file = .vault_pass
ls -la trellis/group_vars/*/vault.yml
```

Restore any missing file from the backup:

```bash
cp ~/trellis-backup/trellis/.vault_pass ~/code/website.com/trellis/
cp ~/trellis-backup/trellis/ansible.cfg ~/code/website.com/trellis/
```

## Doing it with a script

The steps do not change from project to project, only the excluded list, so I keep them in a script, `wp-ops trellis-updater`. It makes a timestamped backup (so running it twice does not overwrite the first), generates the diff, asks for confirmation before it overwrites `trellis/`, and then commits. Whatever you use, keep the excludes in one place, because that list is what protects the project.

---

*Update Trellis a different way, for example by merging upstream? Find me on Mastodon at [@jfrumau@mastodon.social](https://mastodon.social/@jfrumau).*
