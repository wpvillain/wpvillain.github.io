---
layout: post
title: "Creating WordPress Pages from Block Markup with WP-CLI on Trellis: VM First, Production Second, and the .test URLs That Follow You"
date: 2026-10-28 23:40:00 +0700
categories: wordpress wp-cli trellis
tags: [wordpress, wp-cli, trellis, bedrock, gutenberg, block-patterns, lima, deployment]
case_category: development
case_status: documented
---

Building a page in the block editor and building it from a file are different workflows, and the second is better when you want the page in version control, repeatable on production, and generated from the theme's patterns. You write the Gutenberg block markup into an HTML file and let WP-CLI create the page.

It works, and it has three traps: WP-CLI has to run inside the Trellis VM, the slug you want may already be taken by an attachment, and a page built locally carries your `.test` URLs into production. This is the sequence I use.

## 1. Write the content file

A plain HTML file made of block comments:

```html
<!-- wp:group {"align":"full","backgroundColor":"base","style":{"spacing":{"padding":{"top":"var:preset|spacing|60","bottom":"var:preset|spacing|60"}}},"layout":{"type":"default"}} -->
<div class="wp-block-group alignfull has-base-background-color has-background">
  <!-- wp:heading {"textAlign":"center","level":1} -->
  <h1 class="wp-block-heading has-text-align-center">About</h1>
  <!-- /wp:heading -->
</div>
<!-- /wp:group -->
```

Use your theme's spacing and colour presets, not pixel values. Check `theme.json` for what exists. If the theme registers block patterns, you can reference them instead of pasting their markup:

```html
<!-- wp:pattern {"slug":"theme-name/hero-modern-light"} /-->
```

The slug has to match a registered pattern exactly, or nothing renders.

## 2. Check the slug is free

Do this before creating the page, not after:

```bash
cd ~/code/example.com/trellis
trellis vm shell --workdir /srv/www/example.com/current -- \
  wp post list --name=about --post_type=any --path=web/wp \
  --fields=ID,post_type,post_title,post_name,post_status
```

`--post_type=any` matters. The usual culprits are an **attachment** that got the slug `about` from an uploaded image, a draft from an earlier attempt, and a trashed page nobody emptied. If you skip this, WordPress quietly creates the page as `about-2`.

Delete the conflicts with their real IDs:

```bash
trellis vm shell --workdir /srv/www/example.com/current -- \
  wp post delete 2366 1366 --force --path=web/wp
```

## 3. Put the file where the VM can read it

Trellis on Lima syncs your project directory into the VM, so the Bedrock `site/` folder appears at `/srv/www/example.com/current/site/`. A file outside the project is invisible to the VM:

```bash
cp about-page-content.html ~/code/example.com/site/about-page-content.html
```

## 4. Create the page

```bash
trellis vm shell --workdir /srv/www/example.com/current -- bash -c '
CONTENT=$(cat /srv/www/example.com/current/site/about-page-content.html)
wp post create \
  --post_type=page \
  --post_title="About" \
  --post_name="about" \
  --post_status=publish \
  --post_content="$CONTENT" \
  --path=web/wp
'
```

The quoting is the part that goes wrong. Single quotes on the outside so the host shell does not expand anything, and double quotes around `$CONTENT` inside. If your page ends up containing the literal text `$(cat ...)`, you used double quotes on the outside.

You get `Success: Created post 12306.` Verify it saved what you meant:

```bash
trellis vm shell --workdir /srv/www/example.com/current -- \
  wp post get 12306 --path=web/wp --fields=ID,post_title,post_name,post_status

trellis vm shell --workdir /srv/www/example.com/current -- \
  wp post get 12306 --path=web/wp --field=post_content | grep -o "A phrase from your content"
```

If the slug came out as `about-2`, fix it and flush the cache:

```bash
trellis vm shell --workdir /srv/www/example.com/current -- wp post update 12306 --post_name=about --path=web/wp
trellis vm shell --workdir /srv/www/example.com/current -- wp cache flush --path=web/wp
```

Delete the temporary content file from `site/` when you are done, so it does not end up in a commit.

## Why not just run wp on the host?

`Error: Can't read wp-config.php file` is what you get. A MariaDB running on your Mac's port 3306 conflicts with the VM's database, and the host `wp` cannot reach the one WordPress is configured for. Always go through `trellis vm shell`.

## Updating an existing page

Use `wp post update` with the page ID. A heredoc with a quoted delimiter keeps the shell from expanding `$` and backticks inside your markup:

```bash
trellis vm shell --workdir /srv/www/demo.example.com/current -- bash << 'VMEOF'
cat > /tmp/page-content.html << 'EOF'
<!-- wp:pattern {"slug":"theme-name/hero-modern-dark"} /-->
<!-- wp:pattern {"slug":"theme-name/hero-modern-light"} /-->
EOF
CONTENT=$(cat /tmp/page-content.html)
wp post update 1848 --post_content="$CONTENT" --url=https://demo.example.test/ --path=web/wp
VMEOF
```

On multisite, always include `--url`. The page ID only exists on one site.

To find the patterns a theme provides, search its files for the header:

```bash
grep -rh "^ \* Slug:" web/app/themes/your-theme/patterns/
```

## Production

There are three ways to get the page there.

**A script.** Copy the file to the server, check for slug conflicts, create the page, verify, clean up. I keep this as a wp-ops command, which prompts before deleting anything:

```bash
wp-ops page-creation about-page-content.html "About" about
```

**By hand.** The same commands over SSH, from the release directory:

```bash
scp about-page-content.html web@example.com:/tmp/
ssh web@example.com "cd /srv/www/example.com/current && \
  wp post create --post_type=page --post_title='About' --post_name='about' \
  --post_status=publish --post_content=\"\$(cat /tmp/about-page-content.html)\" --path=web/wp \
  && rm /tmp/about-page-content.html"
```

**Export and import** the single page with `wp export --post__in=<ID>` and `wp import`, when you want to carry over its meta too.

## The part that bites: local URLs in the database

Pattern files often print image paths with `get_template_directory_uri()`. When a pattern is inserted into a page, that URL is **written into the database as text**, using whatever the current environment's URL is. Build the page locally and the content now contains `http://example.test/app/themes/...`. On production that is a mixed-content warning at best and a broken image at worst.

Audit before you go live:

```bash
ssh web@example.com "cd /srv/www/example.com/current && \
  wp db query \"SELECT ID, post_title, post_name FROM wp_posts WHERE post_content LIKE '%.test%';\" \
  --path=web/wp"
```

If anything comes back, take a backup and replace:

```bash
ssh web@example.com "cd /srv/www/example.com/current && \
  wp db export /tmp/before-url-fix-\$(date +%Y%m%d_%H%M%S).sql.gz --path=web/wp"

ssh web@example.com "cd /srv/www/example.com/current && \
  wp search-replace 'http://example.test' 'https://example.com' --all-tables --precise --path=web/wp"

ssh web@example.com "cd /srv/www/example.com/current && wp cache flush --path=web/wp"
```

On a multisite subsite, add `--url=https://demo.example.com` to each command. Then open the page with the browser console open and look for requests to a `.test` host. The flags are explained in [the search-replace post]({% post_url 2026-10-28-wp-search-replace-wordpress-url-domain-https-bedrock-paths %}).

## Checklist

- [ ] Content uses theme presets, no pixel values or hard-coded colours
- [ ] Slug checked with `--post_type=any`
- [ ] Created from inside the VM, not the host
- [ ] Verified with `wp post get` and a phrase from the content
- [ ] Production audited for `.test` URLs, and fixed with a backup first
- [ ] Cache flushed, page checked in a browser with the console open

---

*Deploy pages another way, or run into a quoting case I missed? Find me on Mastodon at [@jfrumau@mastodon.social](https://mastodon.social/@jfrumau).*
