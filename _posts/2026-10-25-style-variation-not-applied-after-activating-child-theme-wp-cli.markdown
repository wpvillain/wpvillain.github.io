---
layout: post
title: "Child Theme Activated but the Style Variation Is Gone: Global Styles Are Per Theme (and wp_insert_post Needs a User in WP-CLI)"
date: 2026-10-25 14:00:00 +0700
categories: wordpress fse wp-cli
tags: [wordpress, fse, wp-cli, block-themes, child-theme, global-styles, style-variations]
case_category: debugging
case_status: documented
---

I activated a block child theme on a multisite subsite and rebuilt its pages from the child's patterns. The layout was right, but the colours and fonts were the parent's defaults. The child ships a style variation, and it simply wasn't applied.

Two things are worth knowing here.

## Global styles belong to one theme

The Site Editor stores your choices (including a selected style variation) in a `wp_global_styles` post. That post is linked to the theme by a term in the `wp_theme` taxonomy, and the term is the theme's stylesheet slug. Switching from `elayne` to `elayne-legal` means WordPress looks for a different post. The variation chosen under the parent stays on the parent's post and does not carry over.

On a site you click through, you pick the variation again under Appearance > Editor > Styles. On a demo you deploy by script, nobody does.

## Creating the post from WP-CLI: the term is silently skipped

My first fix was to build the user styles from the child's `styles/legal-corporate.json` and insert them:

```php
wp_insert_post( array(
	'post_type'    => 'wp_global_styles',
	'post_name'    => 'wp-global-styles-elayne-legal',
	'post_status'  => 'publish',
	'post_content' => wp_slash( wp_json_encode( $styles ) ),
	'tax_input'    => array( 'wp_theme' => array( 'elayne-legal' ) ),
) );
```

It returned an ID and the page did not change. `tax_input` is checked against the current user's capabilities, and WP-CLI runs with no user by default, so the term was dropped without an error. The post existed but belonged to no theme. WordPress then created its own empty post for the child, with the slug `wp-global-styles-elayne-legal-2`, which is why it looked like a duplicate.

You can see the state with:

```bash
wp post list --post_type=wp_global_styles --fields=ID,post_name
wp eval 'echo WP_Theme_JSON_Resolver::get_user_global_styles_post_id();'
```

## The fix

Set the term directly. `wp_set_object_terms()` does no capability check. Or run the whole command with `--user=<admin>` and keep `tax_input`.

```bash
wp eval '
wp_update_post( array( "ID" => 111, "post_name" => "wp-global-styles-elayne-legal" ) );
wp_set_object_terms( 111, "elayne-legal", "wp_theme" );
delete_transient( "global_styles" );
'
```

Here 111 is the post WordPress had created, with my styles copied into its content. Then I deleted my orphan.

One detail for the content: a variation file lists presets as plain arrays (`palette`, `fontSizes`, `fontFamilies`, and so on). In the user styles post each of those sits under a `theme` key, so wrap them: `"palette": {"theme": [ ... ]}`. Copy a post that the editor wrote if you are unsure of the shape.

## Check it without logging in

Look at the preset the page actually prints:

```bash
curl -s https://example.com/legal/ | grep -o -E '\-\-wp--preset--color--primary:[^;]*'
```

Before the fix it printed the parent's colour. After, it printed the variation's navy. No browser and no cache guesswork.
