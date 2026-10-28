---
layout: post
title: "My Block Theme Template Changes Are Ignored: Find and Remove the Site Editor's Database Override With WP-CLI"
date: 2026-10-30 09:30:00 +0700
categories: wordpress wp-cli block-themes
tags: [wordpress, block-themes, wp-cli, site-editor, templates, woocommerce, trellis, bedrock]
case_category: debugging
case_status: shipped
---

I changed a pattern file in a block theme, flushed the cache, and the front end kept showing the old markup. Editing the template's `.html` file did nothing either. The cause was not the cache. When a template is saved in the Site Editor, WordPress stores a copy as a `wp_template` post in the database, and that copy beats the file on disk from then on.

## Recognise it

- You edited a PHP pattern or a template `.html` and the front end still shows the old blocks.
- Attributes rendered by a block (an image sizing attribute, a data attribute) still have the old values.
- `wp cache flush` changes nothing.

List the templates stored in the database:

```bash
wp post list --post_type=wp_template \
  --fields=ID,post_name,post_status \
  --path=web/wp \
  --url=https://example.com/store/
```

`--url` matters on multisite, because each subsite has its own templates. Then read the stored content:

```bash
wp post get <ID> --field=post_content --path=web/wp --url=https://example.com/store/ | head -100
```

If you see static block markup instead of a pattern reference like `<!-- wp:pattern {"slug":"theme/slug"} /-->`, the pattern was inlined when the template was saved. Your edits to the pattern file can never reach it.

## Option A: delete the override

When the theme files should be the source of truth:

```bash
wp post delete <ID> --force --path=web/wp --url=https://example.com/store/
```

WordPress falls back to the theme's `.html` template, and pattern references are evaluated from PHP on each request again.

## Option B: patch the stored copy

When the database copy has other customisations worth keeping, replace only the part that changed:

```bash
wp eval '
$post_id = 123;
$content = get_post($post_id)->post_content;

$old = "<!-- wp:woocommerce/product-image {\"imageSizing\":\"thumbnail\"} /-->";
$new = "<!-- wp:woocommerce/product-image {\"aspectRatio\":\"3/4\"} /-->";

if (strpos($content, $old) !== false) {
    wp_update_post(["ID" => $post_id, "post_content" => str_replace($old, $new, $content)]);
    echo "Updated\n";
} else {
    echo "Old string not found, check the content manually\n";
}
' --path=web/wp --url=https://example.com/store/

wp cache flush --path=web/wp --url=https://example.com/store/
```

The `$old` string has to match exactly, including escaped quotes and newlines. That is why the script prints a message when it finds nothing, instead of writing blindly.

## On a Trellis VM

Prefix with the VM shell and use the development URL:

```bash
trellis vm shell --workdir /srv/www/demo.example.com/current -- \
  wp post list --post_type=wp_template --fields=ID,post_name,post_status \
  --path=web/wp --url=http://demo.example.test/store/
```

Delete and flush work the same way. Your local `wp` cannot see the VM's database, so run it inside the VM.

## Stop it coming back

After you delete or repair the override, avoid saving that template in the Site Editor, because that creates a new override. Edit the theme's `.html` file or the pattern files instead. For local development in Bedrock, `WP_DEVELOPMENT_MODE=theme` in `config/environments/development.php` makes WordPress skip theme caching, so PHP file edits show up immediately.

If the symptom is that a style variation does not apply instead, that is a [different database override]({% post_url 2026-10-25-style-variation-not-applied-after-activating-child-theme-wp-cli %}).
