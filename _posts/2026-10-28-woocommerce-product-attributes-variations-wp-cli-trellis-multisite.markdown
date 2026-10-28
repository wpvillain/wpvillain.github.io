---
layout: post
title: "WooCommerce Product Attributes and Variations with WP-CLI on Trellis: Why Your Terms Land on the Wrong Site"
date: 2026-10-28 20:00:00 +0700
categories: wordpress woocommerce wp-cli trellis
tags: [woocommerce, wp-cli, trellis, multisite, product-attributes, product-variations, bedrock]
case_category: development
case_status: documented
---

Setting up a WooCommerce catalogue by hand means clicking through Products, Attributes, Configure terms, once per value. With WP-CLI you can create the attributes, fill them with terms and add variations in a script. The commands are simple. What goes wrong is where they run: on a multisite store, a command without the right `--url` quietly targets the main site.

This is the set of commands I use on a Trellis and Bedrock site, with the mistakes that cost time.

## What you need

- WooCommerce active on the site you are targeting.
- WP-CLI with the `wp wc` commands available (they ship with WooCommerce).
- `--user=admin`: the `wp wc` commands go through the REST layer and need a user. A login or a numeric ID both work.
- `--path=web/wp` on Bedrock, so WP-CLI finds WordPress.

The same command runs three ways. Locally, through the Trellis VM:

```bash
cd /path/to/trellis && trellis vm shell --workdir /srv/www/example.test/current -- \
  wp --url=http://example.test wc product_attribute create \
    --name="Leather Colour" --slug="pa_leather-colour" --type="select" \
    --user=admin --path=web/wp 2>&1
```

On a server, over SSH:

```bash
ssh web@example.com "cd /srv/www/example.com/current && \
  wp wc product_attribute create \
    --name='Leather Colour' --slug='pa_leather-colour' --type='select' \
    --user=admin --path=web/wp"
```

The rest of this post shows the bare `wp ...` form. Wrap it whichever way fits. The `2>&1` on the VM version keeps WP-CLI warnings in the output, which matters here because the failures are warnings.

## Create attributes

```bash
wp wc product_attribute create --name="Color"    --slug="pa_color"    --type="select" --user=admin --path=web/wp
wp wc product_attribute create --name="Size"     --slug="pa_size"     --type="select" --user=admin --path=web/wp
wp wc product_attribute create --name="Material" --slug="pa_material" --type="select" --user=admin --path=web/wp
```

`--type` takes `select` for a dropdown. `button` is for swatch plugins.

The term commands below need the attribute's taxonomy name, which is the slug with the `pa_` prefix. Before you script anything, confirm what was created:

```bash
wp wc product_attribute list --user=admin --path=web/wp --format=table
wp taxonomy list --path=web/wp | grep pa_
```

## Add terms

An attribute is a taxonomy, so its values are terms:

```bash
wp term create pa_leather-colour "Black" --user=admin --path=web/wp
wp term create pa_leather-colour "Tan"   --user=admin --path=web/wp
```

For a longer list, loop:

```bash
for TERM in "Black" "Brown" "Tan" "Burgundy" "Navy"; do
  wp term create pa_leather-colour "$TERM" --user=admin --path=web/wp
done
```

List them back with the attribute's numeric ID from the earlier list:

```bash
wp wc product_attribute_term list 1 --user=admin --path=web/wp --format=table
```

## The multisite trap

If the store is a subsite, for example `example.test/store`, every one of these commands needs `--url` pointing at it:

```bash
wp --url=http://example.test/store term create pa_leather-colour "Black" --user=admin --path=web/wp
```

Leave it off and WP-CLI runs against the main site. Creating terms there does not fail. It just puts them in the wrong place, and you find out when the dropdown in the store is empty. Updating a product ID that only exists on the subsite fails with `Warning: Invalid post ID.`, which at least tells you.

The rule I follow now: on a network, copy the full `--url=.../store` into the first command and keep it in every one after.

## Create variations

The number after `create` is the **parent product ID**. The attribute names are the taxonomy slugs, and the values must already exist as terms:

```bash
wp --url=http://example.test/store wc product_variation create 36 \
  --attributes='[{"attribute": "pa_leather-colour", "value": "Tan"}, {"attribute": "pa_style", "value": "A4 Slim"}]' \
  --regular_price=99 \
  --user=admin --path=web/wp
```

With a SKU and managed stock:

```bash
wp --url=http://example.test/store wc product_variation create 36 \
  --attributes='[{"attribute": "pa_leather-colour", "value": "Tan"}, {"attribute": "pa_style", "value": "A4 Slim"}]' \
  --regular_price=99 --sku="PROD-36-TAN-A4SL" \
  --stock_quantity=10 --manage_stock=true \
  --user=admin --path=web/wp
```

Through the Trellis VM the output includes a lot of `limactl` noise. Pipe the result through `grep -E "Success|Error"` to keep just the line you care about.

## Update a variation

A variation is a post of type `product_variation`, so the post commands work on it:

```bash
wp --url=http://example.test/store post meta update 36 _regular_price "29.99" --path=web/wp
wp --url=http://example.test/store post meta update 36 _price "29.99" --path=web/wp
wp --url=http://example.test/store post meta update 36 _stock_status "instock" --path=web/wp
```

Setting `_regular_price` alone leaves `_price` as it was. Update both when you change a price this way.

## Raw SQL: two mistakes

When the commands are not enough, `wp db query` runs SQL. Two things trip people up.

**A doubled `wp`.** The `--url` flag belongs to the same invocation as the subcommand:

```bash
# Wrong: Error: 'wp' is not a registered wp command
wp --url=http://example.test/store wp db query "SELECT ..." --path=web/wp

# Right
wp --url=http://example.test/store db query "SELECT ..." --path=web/wp
```

**The table prefix.** Subsite tables carry the site ID, so it is `wp_10_posts`, not `wp_posts`. Look the ID up first:

```bash
wp --url=http://example.test/store db query "SELECT blog_id, domain, path FROM wp_blogs" --path=web/wp
```

Then use `wp_<id>_` in the query. Check the result with a read before you run an `UPDATE`, for example:

```bash
wp --url=http://example.test/store post get 36 --field=post_type --path=web/wp
```

## List and delete

```bash
wp --url=http://example.test/store post list \
  --post_type=product --fields=ID,post_title,post_status --format=table --path=web/wp

# Deleting an attribute also removes its terms
wp wc product_attribute delete 1 --user=admin --path=web/wp
```

---

*Scripting a WooCommerce setup another way, or hit a multisite quirk I missed? Find me on Mastodon at [@jfrumau@mastodon.social](https://mastodon.social/@jfrumau).*
