---
layout: post
title: "How Trellis's database-pull Playbook Works (And What We Fixed)"
date: 2026-02-27 10:00:00 +0700
categories: wordpress trellis ansible bedrock
tags: [wordpress, trellis, ansible, bedrock, database, wp-cli, roots, deployment]
case_category: devops
case_status: patched
---

{% raw %}
One of the most useful Trellis commands in day-to-day WordPress development is `trellis db pull`. It syncs your production (or staging) database down to local — switching URLs automatically so your dev site works immediately. But the playbook behind it does more than most developers realise, and the default Trellis version had some issues we needed to fix before it worked reliably.

This post walks through exactly what `database-pull.yml` does, the safety feature hidden in the middle of it, and the two patches we made to get it working correctly with a Bedrock project.

## What the Playbook Does

Running `trellis db pull production` executes `database-pull.yml` against your production host. Here's the sequence:

### 1. Pre-flight validation

Before touching any database, the playbook checks three things:

```yaml
- name: Abort if environment variable is equal to development
  fail:
    msg: "ERROR: development is not a valid environment for this mode..."
  when: env == "development"
```

You cannot pull from development to development — a useful guard if you ever mis-type the environment flag.

It also checks that your local project folder exists:

```yaml
- name: Check if {{ site }} local folder exists
  delegate_to: localhost
  stat:
    path: "{{ project_local_path }}"
  register: result
  become: no
```

If the path doesn't exist the playbook aborts with a clear message rather than partially running and leaving things in an inconsistent state.

### 2. Create local backup directory

```yaml
- name: Create local database_backup directory if it doesn't exist
  delegate_to: localhost
  file:
    path: "{{ project_local_path }}/database_backup"
    state: directory
    mode: 0755
  become: no
```

On first run this creates a `database_backup/` folder inside your local Bedrock project root. All backups end up here.

### 3. Dump and transfer the remote database

```yaml
- name: Create database dump on {{ env }}
  shell: wp db export --allow-root - | gzip > {{ dump_file }}
  args:
    chdir: "{{ project_web_dir }}"
```

The dump is created on the remote server, piped through gzip. Then it's fetched to local via Ansible's `fetch` module:

```yaml
- name: Pull database dump from {{ env }} to development
  fetch:
    src: "{{ project_web_dir }}/{{ dump_file }}"
    dest: "{{ project_local_path }}/"
    flat: yes
```

After the transfer the remote dump is deleted immediately — no production files left hanging around on the server.

### 4. The hidden safety feature: backup local first

This is the part most developers don't expect. **Before importing the production dump, the playbook backs up your current local database:**

```yaml
- name: Export development database before importing dump (backup)
  delegate_to: localhost
  shell: wp db export - | gzip > database_backup/{{ backup_file }}
  args:
    chdir: "{{ project_local_path }}/web/wp"
  become: no
```

The backup filename includes a timestamp:

```
imagewize_com_development_2026_02_27_10_30_45.sql.gz
```

So if the import causes any problems — or you realise after the fact that you needed that local data — you can restore it from `database_backup/`. Every pull creates a new timestamped backup, meaning you accumulate a history of your local database states. Worth clearing out periodically.

### 5. Import and search-replace

```yaml
- name: Import database dump on development
  delegate_to: localhost
  shell: gzip -c -d {{ dump_file }} | wp db import -
  args:
    chdir: "{{ project_local_path }}/web/wp"
  become: no
```

Then the URL swap:

```yaml
- name: Search for {{ url_from }} and replace with {{ url_to }} on development
  delegate_to: localhost
  command: wp search-replace '//{{ url_from }}' '//{{ url_to }}' --allow-root --all-tables --precise
```

Both `url_from` (production) and `url_to` (local) are resolved from config automatically. After this step your local WordPress is fully functional with production content.

---

## What We Fixed

The version of `database-pull.yml` we started with had two problems.

### Fix 1: Broken hostvars references

The original playbook resolved local site config like this:

```yaml
host: "{{ env }}_host"
from_host: "{{ hostvars[host] }}"
url_from: "{{ from_host.wordpress_sites[site].site_hosts.0.canonical }}"
url_to: "{{ hostvars.development_host.wordpress_sites[site].site_hosts.0.canonical }}"
local_bedrock_dir: "{{ hostvars.development_host.wordpress_sites[site].local_path }}"
```

It was trying to read the development site config via `hostvars.development_host`, which required that host to be in the play's host inventory. Since the playbook only targets `web:&{{ env }}` (the remote server), `development_host` wasn't always populated at the right time. This caused intermittent failures that were hard to reproduce.

The fix was to load the development config directly using `vars_files` and a file lookup:

```yaml
vars_files:
  - group_vars/development/wordpress_sites.yml

vars:
  url_from: "{{ wordpress_sites[site].site_hosts.0.canonical }}"
  dev_wordpress_sites: "{{ lookup('file', 'group_vars/development/wordpress_sites.yml') | from_yaml }}"
  url_to: "{{ dev_wordpress_sites.wordpress_sites[site].site_hosts.0.canonical }}"
  project_local_path: "{{ dev_wordpress_sites.wordpress_sites[site].local_path }}"
```

Reading the file directly is more reliable than relying on `hostvars` being populated for a host that isn't part of the current play.

### Fix 2: Wrong delegate_to target

The original used `delegate_to: development_host` for local tasks:

```yaml
- name: Create database_backup directory if it doesn't exist
  delegate_to: development_host
  file:
    path: "{{ project_web_dir }}/database_backup"
    ...
```

Two problems here: `development_host` has the same availability issue as above, and the path was using `project_web_dir` (the remote path) instead of the local Bedrock path.

Replacing with `delegate_to: localhost` and correcting the path:

```yaml
- name: Create local database_backup directory if it doesn't exist
  delegate_to: localhost
  file:
    path: "{{ project_local_path }}/database_backup"
    state: directory
    mode: 0755
  become: no
```

The `become: no` is also important — local tasks shouldn't run as root.

---

## Using It

Once the playbook is correct, pulling production to local is a single command run from the Trellis directory:

```bash
cd trellis
trellis db pull production
```

For a Bedrock project the WP path is in the `web/wp` subdirectory, which the playbook handles automatically via the chdir arguments.

If you want to run just the search-replace step again (useful if something went wrong):

```bash
trellis db pull production --tags search-replace
```

---

## Takeaway

The Trellis database-pull playbook is well-designed, but the default version had brittle `hostvars` lookups that could fail depending on how hosts were configured. Switching to direct file lookups and `delegate_to: localhost` made it deterministic.

The built-in local backup before import is a genuinely useful safety net that's easy to miss since it's buried in the middle of the playbook. Your `database_backup/` directory quietly accumulates timestamped snapshots of every pull — worth knowing about before you hit a situation where you need it.

This is part of the Trellis-based WordPress deployment workflow we use at [Imagewize](https://imagewize.com) for client projects. If you're running a Trellis stack and want help setting up or debugging your deployment pipeline, [get in touch](https://imagewize.com/contact-us/).

---

*Questions or issues with your Trellis setup? Find me on Mastodon at [@jfrumau@mastodon.social](https://mastodon.social/@jfrumau).*
{% endraw %}
