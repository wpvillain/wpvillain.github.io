---
layout: post
title: "What Claude Code Actually Ran Against My WordPress Sites: wp-ops or Plain WP-CLI"
seo_title: "Claude Code and WP-CLI: wp-ops MCP vs Plain wp, Counted"
description: "I counted every WP-CLI call Claude Code made across my WordPress projects. The wp-ops MCP tool won on production, plain wp over trellis vm shell won on development, and here is what each command was for."
date: 2026-11-15 16:00:00 +0700
categories: ai wp-cli devops
tags: [ai, claude-code, mcp, wp-cli, wp-ops, trellis, bedrock, multisite, devops]
case_category: ai
case_status: documented
---

[wp-ops](https://github.com/imagewize/wp-ops) has an MCP server, and its most used tool is `wp_cli`: give it a site name, an environment and a WP-CLI command, and it runs that command on the right server in the right Bedrock path. I assumed that was how Claude Code talked to my WordPress sites. Then I counted, and it is only half the story. Claude Code ran plain `wp` through `ssh` and `trellis vm shell` about as often as it used the tool, and on development it almost never used the tool at all.

This post is that count: what went through wp-ops, what went around it, and which WP-CLI commands did the work.

## How I counted

Claude Code keeps every session as a JSONL transcript under `~/.claude/projects/`, one folder per project. Each tool call is a `tool_use` block with an ID, a tool name and its input. I read every transcript on this machine, about two months of work, and counted:

- calls to the wp-ops MCP tools, by tool, and for `wp_cli` by WP-CLI command;
- Bash calls that ran `wp` directly, by command and by route (`trellis vm shell`, `ssh`, or local).

Count each call ID once. My first count counted lines, and a resumed or forked session repeats the calls that came before it, so that count came out about 50% too high. For Bash I give a range: the high figure is every Bash call with a `wp` command in it; the low figure leaves out calls where `wp` only appears inside a heredoc, a commit message or a Python edit. Hand-typed terminal commands are not in the transcripts, so they are not in the count either.

## The numbers

| Route | Calls | Development | Production and staging |
| --- | --- | --- | --- |
| wp-ops `wp_cli` MCP tool | 398 | 39 | 358 |
| Plain `wp` in a Bash call | 312 to 446 | 163 via `trellis vm shell` | 113 via `ssh` |

On production the MCP tool was used about three times as often as plain `ssh … wp`. On development it was the other way round: `trellis vm shell -- wp` about four times as often as the tool.

The other wp-ops tools were used far less: `publish_post` 46, `ssh_command` 29, `verify_post` 24, `db_backup` 23, `scp_file` 16. The audits, scanners and monitors together came to about 20 of the 557 MCP calls.

## Why the tool got used at all

My first guess was that Claude Code reached for the MCP tool because plain `wp` over `ssh` kept getting blocked. The transcripts say otherwise. Refusals were rare on both routes: 5 of about 150 `ssh … wp` calls (3 by Claude Code's auto mode safety check, 2 by me), 2 of about 220 `trellis vm shell` calls, and 6 `wp_cli` calls, about the same rate. After a refused `ssh` call, Claude Code switched to the MCP tool exactly once.

The real reason was my own instructions. Every project where the tool was used had a line in its `CLAUDE.md` or `AGENTS.md` saying to prefer the wp-ops `wp_cli` tool over raw `ssh` and `wp`. The plugin and theme repos that only documented `trellis vm shell -- wp` got plain `wp`, every time. The agent did what the project file said.

The tool also had friction of its own. Its read-only check, which lets reads through and asks for confirmation on writes, refused 35 calls. Some were real writes, as intended. But 20 were reads: `wp db query "SELECT …"` (SQL can write, so `db query` always asks), a read with `--url=` placed before the command (which threw off the check), and `wp wc product list`. Another 17 calls failed because the command went in as one string instead of a list of words.

So I changed the project files: plain `wp` is fine, and the `wp_cli` tool is optional.

## Why plain wp won on development

My development sites run in a Lima VM that Trellis manages, so a `wp` on the Mac sees no database at all. Every development command has to go through the VM:

```bash
trellis vm shell --workdir /srv/www/example.com/current -- wp post list --post_type=page --path=web/wp
```

That works fine on its own, and it does more than the MCP tool can, because the tool runs one WP-CLI command per call and returns its output. Most development calls needed something else in the same call:

- **Several commands in a row**, wrapped in `bash -c`: update a post, flush the cache, read the post back.
- **A pipe**: `wp post meta list 6765 --format=csv | grep -i genesis`, or `… | tail -2` to drop the noise.
- **A check outside WordPress**: run `wp post update`, then `curl` the page and grep the rendered HTML.
- **A file as input**: SQL from a file for `wp db query`, or a PHP script for `wp eval-file`.

On production the MCP tool saves the SSH string, the site path and the `--path=web/wp`, and a single read like `wp post get 4621 --field=post_content` needs nothing else. But that saving is small, and it only won there because the project files said to use it. When a production job needed a pipe or a file, Claude Code went back to `ssh` anyway.

## The commands, and what they were for

Counts are the MCP tool and plain `wp` together, rounded.

### Reading content: `wp post list`, `wp post get`

About 150 calls, the biggest group. `post list` finds the page or post: by slug, by status, by post type, before editing anything. `post get --field=post_content` reads the block markup that is about to be changed, and reads it back afterwards to check the change landed.

```bash
wp post list --post_type=page --name=contact --fields=ID,post_title,post_status --path=web/wp
wp post get 4621 --field=post_content --path=web/wp
```

### SEO titles and featured images: `wp post meta`

About 60 calls, most of them `post meta update`. The SEO plugin on these sites is The SEO Framework, which keeps a post's custom title and description in `_genesis_title` and `_genesis_description`, and whether the site name is appended in `_tsf_title_no_blogname`. Rewriting titles and descriptions one post at a time was the main write job on production. `_thumbnail_id` came up when a featured image needed swapping.

```bash
wp post meta update 6765 _genesis_title 'WordPress & WooCommerce Takeovers and Fixes | Imagewize' --path=web/wp
wp post meta list 6765 --keys=_genesis_title,_genesis_description --path=web/wp
```

### Questions WP-CLI has no command for: `wp db query`

About 60 calls. Whenever the question was "how many" or "which rows", SQL was quicker than any loop over `wp post list`:

- counting development URLs left in `post_content` after a database push (`LIKE '%.test%'`);
- finding options and post meta left behind by plugins removed long ago (`_yoast_wpseo_%`, `_imagify_%`, `wpml_media_%`) before deleting them;
- checking whether a plugin's tables still exist (`SHOW TABLES LIKE '%gf%'`);
- counting posts on one multisite subsite, which means using its own table prefix, such as `wp_13_posts`.

```bash
wp db query "SELECT COUNT(*) FROM wp_posts WHERE post_content LIKE '%.test%'" --skip-column-names --path=web/wp
```

Bigger cleanups went into a `.sql` file first, so the statements could be read before they ran, and were followed by `wp cache flush`.

The shapes those questions took, with `example.com` standing in for the real site:

```bash
# Which plugin leftovers are still in the options table? Escape the underscores:
# in LIKE, an unescaped _ matches any single character.
wp db query "SELECT option_name FROM wp_options WHERE option_name LIKE '\\_yoast\\_wpseo\\_%'" \
  --skip-column-names --path=web/wp

# How much post meta do they hold? Count before deleting anything.
wp db query "SELECT COUNT(*) FROM wp_postmeta WHERE meta_key LIKE '\\_imagify\\_%'" \
  --skip-column-names --path=web/wp

# Is a removed plugin's table still there?
wp db query "SHOW TABLES LIKE '%gf%'" --skip-column-names --path=web/wp

# Published posts on subsite 13 of a multisite network: its own table prefix, no --url needed.
wp db query "SELECT COUNT(*) FROM wp_13_posts WHERE post_type = 'post' AND post_status = 'publish'" \
  --skip-column-names --path=web/wp
```

A cleanup that deletes rows goes in a file, gets read, and runs with a database export taken first:

```bash
wp db export before-cleanup.sql --path=web/wp
cat cleanup.sql
# DELETE FROM wp_postmeta WHERE meta_key LIKE '\_imagify\_%';
# DELETE FROM wp_options WHERE option_name LIKE '\_transient\_%';
wp db query < cleanup.sql --path=web/wp
wp cache flush --path=web/wp
```

`wp db query` runs whatever SQL it is given, `DELETE` included, so it is a write whenever the statement is not a `SELECT` or `SHOW`.

### One line of PHP: `wp eval`

About 85 calls. `wp eval` runs PHP inside a loaded WordPress, which answers questions no command covers:

- **Does mail work after an msmtp upgrade?** `wp eval` with a `wp_mail()` call after upgrading msmtp on a Trellis server, once on development and once on production. A bare `var_dump( wp_mail( … ) )` only says whether mail was handed off; [testing mail for real](#testing-mail-for-real) below shows a version that also reports why a send failed.
- **What does a plugin function return for this theme?** Call it directly and echo the result, on each multisite subsite in turn with `--url`.
- **What is in the global styles?** Read the user global styles post through `WP_Theme_JSON_Resolver::get_user_global_styles_post_id()` and decode its JSON.

More than half of the `eval` calls through the MCP tool read global styles or applied an Elayne style variation's JSON (`styles/*.json`) to a demo subsite's global styles, the job described in [why a style variation is not applied after activating a child theme](/style-variation-not-applied-after-activating-child-theme-wp-cli/).

### Longer PHP: `wp eval-file`

About 25 calls. Once an `eval` one-liner grew past a few statements, it moved into a file, such as a script that syncs a theme's palette into the saved global styles. One snag: `wp eval-file script.php --apply` fails, because WP-CLI rejects flags it does not know for `eval-file`. Pass `apply` as a plain positional argument instead, and read it from `$args` in the script.

```bash
# Without the argument the script only reports what it would change.
wp eval-file sync-palette.php --path=web/wp
wp eval-file sync-palette.php apply --path=web/wp
```

```php
<?php
// sync-palette.php
$apply = in_array( 'apply', $args, true );

// ... compare the theme palette with the saved one, collect the differences ...

if ( ! $apply ) {
    WP_CLI::log( 'Dry run. Pass "apply" to save.' );
    return;
}
// ... write the saved global styles ...
WP_CLI::success( 'Palette synced.' );
```

A script that previews first and writes only when told to is the same dry-run habit as `search-replace`, built by hand.

### Settings: `wp option get`, `option update`, `option patch`

About 60 calls. `page_on_front` to confirm which page is the front page, SEO plugin settings, WooCommerce feature switches. `option patch` changes one key inside a serialized option array without rewriting the whole option, which is what you want for a plugin's settings array. `admin_email_lifespan` set into the future stops the "is this admin email still correct" screen on a demo site. The [autoloaded options post](/wordpress-site-health-autoloaded-options-wp-cli/) covers `option set-autoload`, which came up three times.

### Moving content between URLs: `wp search-replace`

About 30 calls, and about half of them were `--dry-run`. The pattern every time: dry run, read the count, then run it for real.

```bash
wp search-replace 'demo.example.test' 'demo.example.com' 'wp_21_*' \
  --all-tables-with-prefix --precise --dry-run --report-changed-only \
  --url=https://demo.example.com/subsite/ --path=web/wp
```

Run it for real by dropping `--dry-run`, then check the rows it should have changed are gone:

```bash
wp search-replace 'demo.example.test' 'demo.example.com' 'wp_21_*' \
  --all-tables-with-prefix --precise --report-changed-only \
  --url=https://demo.example.com/subsite/ --path=web/wp

wp db query "SELECT COUNT(*) FROM wp_21_posts WHERE post_content LIKE '%demo.example.test%'" \
  --skip-column-names --path=web/wp
```

The same habit for the other jobs it was used for:

```bash
# http to https on a whole single site; leave guid alone, it is a permanent identifier
wp search-replace 'http://example.com' 'https://example.com' \
  --all-tables --precise --skip-columns=guid --dry-run --path=web/wp

# a whole network after a domain change
wp search-replace 'example.test' 'example.com' \
  --network --precise --report-changed-only --dry-run --path=web/wp

# write a rewritten dump instead of touching the database, for a push to another server
wp search-replace 'example.test' 'example.com' --all-tables --precise \
  --export=example-for-production.sql --path=web/wp
```

`--precise` matters on these sites because block markup and plugin settings are serialized, and the faster default replacement can break the string lengths in them. A dry run that reports zero changes on a table you expected to change usually means the table prefix pattern or `--url` is wrong.

The table pattern limits it to one multisite subsite. The full story of search-replace on Bedrock is in [changing a WordPress domain with wp search-replace](/wp-search-replace-wordpress-url-domain-https-bedrock-paths/).

### Checking state: `wp plugin list`, `wp theme list`, `wp site list`, `wp core version`

About 100 calls, almost all reads. What is installed and active before and after an update round, and on multisite, `wp site list` first to get the subsite URL every later command needs as `--url`.

### The rest

`wp cache flush` after direct database writes (about 20). `wp media import` to upload a featured image. `wp post update --post_status=draft` and back to `publish` to test a page while it was offline. `wp config get` and `wp db export`/`import` around migrations. `wp i18n make-pot` locally, to rebuild a plugin's `.pot` file. A handful of `wp user`, `wp menu` and `wc` calls.

Two flags appear on nearly every command above: `--path=web/wp`, because Bedrock keeps WordPress in `web/wp` (or a [`wp-cli.yml`](/bedrock-wp-cli-yml-and-pattern-validate-block-pattern-files/) that sets it), and `--url=` on multisite, because without it WP-CLI acts on the main site.

## Testing mail for real

`wp_mail()` returns `true` when PHPMailer accepted the message, not when it arrived. So a bare `var_dump( wp_mail( … ) )` proves less than it looks like it does. A better test captures the failure reason and then checks where the message ended up.

On a Trellis server, PHP hands mail to `msmtp`, which relays through the SMTP server set in `group_vars/all/mail.yml`:

```yaml
mail_smtp_server: smtp-relay.example.com:587
mail_hostname: example.com
mail_user: smtp_user
mail_password: "{% raw %}{{ vault_mail_password }}{% endraw %}"
```

On development the same setting points at Mailpit instead, in `group_vars/development/mail.yml`, so nothing leaves the VM:

```yaml
php_sendmail_path: "{% raw %}{{ mailpit_install_dir }}{% endraw %}/mailpit sendmail"
```

Trellis writes that `sendmail_path` into both the php-fpm and the php-cli `php.ini`, so a `wp eval` test takes the same route as a page request, unless a plugin overrides mail with its own SMTP settings. That is worth checking before trusting the test: `wp plugin list --status=active` and look for an SMTP or mail plugin.

Send a message and print the error if it fails:

```bash
ssh web@example.com 'cd /srv/www/example.com/current && wp eval '"'"'
add_action( "wp_mail_failed", function ( $e ) { echo "FAILED: ", $e->get_error_message(), "\n"; } );
var_dump( wp_mail( "you@example.com", "Mail test from " . home_url(), "Sent " . gmdate( "c" ) ) );
'"'"' --path=web/wp'
```

This sends a real email, so it is a write in the sense that matters: send it to an inbox you own, and do it on purpose. On development, run it through `trellis vm shell --workdir /srv/www/example.com/current -- wp eval …` and read the result in Mailpit.

Then check three things:

- **The relay's log.** Your SMTP provider's dashboard shows delivered, deferred or blocked. `msmtp` only knows the relay accepted the message, so this is the best proof.
- **The headers of the received message.** `Authentication-Results` should show `spf=pass`, `dkim=pass` and `dmarc=pass` for your domain. A message that arrives in spam with a failing line is the usual real problem, and the fix is a DNS record at the provider, not WordPress.
- **The sender address.** Some relays reject or rewrite a `From` address they have not verified. `wp_mail()` defaults to `wordpress@` plus the site's host, so a failing test with `FAILED:` output often comes down to that address.

Check the DNS records from the same terminal:

```bash
dig +short TXT example.com | grep -i spf
dig +short TXT mail._domainkey.example.com
dig +short TXT _dmarc.example.com
```

The DKIM selector (`mail` above) is whatever your provider tells you to publish.

## What this means for wp-ops

Remote WP-CLI is something many MCP servers already offer, and plain `ssh` does the same job. The count shows it: wp-ops' `wp_cli` tool was mostly a shortcut for reads and single meta writes on production, used because I had told the agent to, and on development it was skipped in favour of `trellis vm shell`. `wp` on its own is a fine tool. So I removed the tool in wp-ops 5.47.0. Plain `wp` replaces it, and the rule it enforced stays: I approve any `wp` command that writes or reads credentials before it runs, whether it goes through `ssh` or `trellis vm shell`, and reads and `--dry-run` previews need no approval.

The parts that nothing else does are the ones tied to Trellis: pulling and pushing a database with the URLs rewritten and a backup first ([refreshing local WordPress from production](/refresh-local-wordpress-from-production-wp-ops/)), publishing a post and verifying that its blocks, JSON-LD and links survive the live render, and syncing a theme to a demo site. Those are what wp-ops now leads with. The generic tools stay, labelled as generic.

If you use Claude Code with WordPress, the transcripts are worth a count of your own, and so is your `CLAUDE.md`. What I thought my agent did and what it actually ran were not the same, and the difference came from a line I wrote months ago.
