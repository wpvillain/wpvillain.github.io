---
layout: post
title: "Setting Up a New Mac for Trellis Development: What Runs on the Host, What Runs in the Lima VM"
date: 2026-10-29 09:00:00 +0700
categories: wordpress trellis devops
tags: [wordpress, trellis, bedrock, lima, macos, homebrew, composer, vite, devops]
case_category: devops
case_status: documented
---

The question I get most about a Trellis setup is whether you need PHP, Composer, Node and MySQL on your Mac if WordPress runs in a virtual machine anyway. The answer is some of them, and installing the wrong ones is how people end up with a port conflict they cannot explain.

This is how I set up a new Mac for Trellis and Bedrock development, and why each tool is on the host or in the VM.

## Two environments

- **The host** is your Mac. You edit code here, build assets, run Composer and Git.
- **The Trellis VM** is an Ubuntu machine run by [Lima](https://lima-vm.io/). It runs Nginx, PHP-FPM, MariaDB and WordPress, and matches production.

Your project folder is synced between the two, so you edit on the Mac and the VM sees the change immediately.

| Tool | Host | VM | Why |
|---|---|---|---|
| Trellis CLI | required | no | Manages the VM |
| Composer | required | included | Installs PHP dependencies into `vendor/`, which syncs to the VM |
| PHP | required | included | On the host it only runs Composer; WordPress runs on the VM's PHP |
| Node.js | required | no | Runs the Vite dev server with hot reload |
| pnpm | optional | no | Faster alternative to npm |
| MariaDB / MySQL | **avoid** | included | A host database on port 3306 conflicts with the VM |
| Nginx, PHP-FPM | **avoid** | included | Only the VM serves the site |
| WP-CLI | optional | included | Run it through `trellis vm shell` |

So the answer to "do I need duplicate tools" is no. Composer and Node on the host build what the VM serves. The VM does not need Node, because it only serves compiled assets.

## Install the tools

```bash
# Homebrew, if you do not have it
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

brew install roots/tap/trellis-cli
brew install composer
brew install php

# Node, through fnm so you can switch versions per project
brew install fnm
fnm install 24
fnm use 24

# Optional
npm install -g pnpm
```

If you use Laravel Valet you already have PHP, Composer and probably MySQL, and that is fine. The VM is isolated. The only thing to watch is the local database on port 3306, covered below.

## SSH key

```bash
ssh-keygen -t ed25519 -C "you@example.com"
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519
cat ~/.ssh/id_ed25519.pub | pbcopy
```

Add the public key at `github.com/settings/keys` and test with `ssh -T git@github.com`. Adding the key to a production server can wait until you need it.

## Check everything

```bash
trellis --version
composer --version
php --version
node --version
ssh -T git@github.com
```

If these answer, the machine is ready. [The next post]({% post_url 2026-10-29-clone-trellis-bedrock-project-lima-vm-first-provision %}) clones a project and gets it running.

## A normal day

```bash
# On the host: dependencies and assets
cd ~/code/your-project/site/web/app/themes/your-theme
pnpm install
pnpm run dev            # Vite with hot reload

# In the VM: anything WordPress
trellis vm shell
wp cache flush
```

Files you save on the Mac appear in the VM, and WordPress serves them with the assets the host built.

## When it goes wrong

**Port 3306 conflict.** Symptom: Ansible playbooks fail with SSH connection errors. A MariaDB or MySQL running on your Mac collides with the VM. Either stop the local server, or run WP-CLI inside the VM and skip the playbooks:

```bash
trellis vm shell --workdir /srv/www/your-project.test/current
wp db export /tmp/backup.sql.gz --path=web/wp
wp cache flush --path=web/wp
```

**The VM will not start.** Look at what Lima thinks, then delete and rebuild it:

```bash
limactl list
trellis vm delete
trellis vm start
trellis provision development
```

**Composer runs out of memory.**

```bash
php -d memory_limit=-1 $(which composer) install
```

---

*Set up your Mac differently, or run Trellis without Lima? Find me on Mastodon at [@jfrumau@mastodon.social](https://mastodon.social/@jfrumau).*
