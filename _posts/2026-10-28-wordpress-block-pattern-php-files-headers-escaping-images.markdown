---
layout: post
title: "Writing Block Patterns as PHP Files: Headers, Escaping, Image Paths and What You Cannot Call on init"
date: 2026-10-28 23:50:00 +0700
categories: wordpress gutenberg php
tags: [wordpress, gutenberg, block-patterns, php, theme-development, escaping, i18n, block-themes]
case_category: development
case_status: documented
---

A block pattern in a theme is a PHP file in `patterns/`. WordPress reads a comment block at the top for the pattern's identity, runs the file to produce block markup, and saves a compiled copy. Most pattern bugs are not layout bugs. They are one of five things: a bad header, a hard-coded media ID, unescaped output, a function that does not exist yet when the pattern is registered, or a string that cannot be translated.

These are the rules I check before a pattern goes into a theme. They come from reading a lot of patterns in the Elayne and Ollie themes (about 140 between them) and from the official docs on [starter patterns](https://developer.wordpress.org/themes/patterns/starter-patterns/) and [PHP in patterns](https://developer.wordpress.org/themes/patterns/using-php-in-patterns/). The layout rules are in [the companion post]({% post_url 2026-10-28-wordpress-block-pattern-layout-alignfull-grid-spacing-rules %}).

## The header

Every pattern file starts with a comment block:

```php
<?php
/**
 * Title: Modern Hero - Light
 * Slug: elayne/hero-modern-light
 * Description: A full-width hero with a heading, text and two buttons
 * Categories: elayne/hero, featured
 */
?>
```

- **Title** is what the inserter shows.
- **Slug** is `namespace/pattern-name` in kebab-case, prefixed with your theme or plugin, and unique across all patterns.
- **Description** says what the pattern is for.
- **Categories** is a comma-separated list of categories you have registered. An unregistered category does not error; the pattern just does not appear where you expect.

Optional fields:

```php
/**
 * Keywords: banner, hero, landing
 * Viewport Width: 1500
 * Block Types: core/post-content
 * Post Types: page
 * Template Types: front-page, home
 * Inserter: no
 */
```

`Block Types: core/post-content` with `Post Types: page` makes a pattern a **page pattern**, offered in the modal when you create a new page. `Template Types` makes it a **template pattern**, usually with `Inserter: no` so it stays out of the inserter and shows up when you create a template in the Site Editor.

## The metadata attribute

WordPress adds a `metadata` object to the outermost block when you insert a pattern from the inserter. Put it in the file yourself:

```html
<!-- wp:group {
  "metadata": {
    "name": "Modern Hero - Light",
    "categories": ["elayne/hero", "featured"],
    "patternName": "elayne/hero-modern-light"
  },
  "align": "full"
} -->
```

It is not required for the block to be valid. Without it the pattern loses its name and categories when the markup is copied to another site. If you include it, make it match the header exactly:

| Metadata | Must equal |
|---|---|
| `name` | `Title:` |
| `patternName` | `Slug:`, including the namespace |
| `categories` | `Categories:`, as an array of **slugs**, never numeric IDs |

The usual mistakes are `"hero-modern-light"` instead of `"elayne/hero-modern-light"`, and `"hero"` when only `"elayne/hero"` is registered. This `metadata` is unrelated to the `block.json` file you use to register a custom block.

## You cannot use query functions in a pattern

WordPress registers patterns on `init` and compiles the file then. There is no query and no current post yet, so anything that depends on them returns nothing or fails:

- Cannot: `is_page()`, `get_post()`, `the_title()`, anything that reads the global query.
- Can: plain PHP (`foreach`, `array_map`), escaping and translation functions, `get_theme_file_uri()`, and theme or plugin functions that do not need the query.

If a pattern needs to vary by page, that is a block (a Query Loop, a Post Title) rather than PHP in the pattern file.

## Images: never a media ID

```html
<!-- Wrong -->
<!-- wp:image {"id":59,"sizeSlug":"full"} -->
<figure class="wp-block-image"><img src="http://example.com/wp-content/uploads/2024/image.jpg" alt=""/></figure>
<!-- /wp:image -->
```

A hard-coded ID refers to a row in one site's media library. On any other install the attachment does not exist, the block fails validation in the editor console, and WordPress runs a pointless query. Ship the image inside the theme and print its URL:

```php
<!-- wp:image {"sizeSlug":"full","linkDestination":"none"} -->
<figure class="wp-block-image size-full">
  <img src="<?php echo esc_url( get_theme_file_uri( 'patterns/images/hero.webp' ) ); ?>" alt="<?php esc_attr_e( 'Team working at a desk', 'elayne' ); ?>"/>
</figure>
<!-- /wp:image -->
```

`get_template_directory_uri()` does the same job in a parent theme. Be aware of the cost: when the pattern is inserted into a page, that URL is saved into the database, so a page built on your laptop carries your `.test` host with it. [This post]({% post_url 2026-10-28-create-wordpress-pages-block-markup-wp-cli-trellis-vm-production %}) shows how to find and fix it.

For featured images in post patterns, name the size:

```html
<!-- wp:post-featured-image {"isLink":true,"aspectRatio":"2/3","sizeSlug":"elayne-portrait-small"} /-->
```

Custom sizes are registered in `functions.php`.

## Escape everything you print

A pattern is PHP, so the usual rules apply, and an unescaped value in a pattern is an XSS bug in the theme.

| Output | Function |
|---|---|
| Text | `esc_html()` / `esc_html_e()` |
| URLs | `esc_url()` |
| Attribute values | `esc_attr()` / `esc_attr_e()` |
| Text that contains HTML | `wp_kses_post()` |

```php
<h2><?php esc_html_e( 'Welcome to My Site', 'elayne' ); ?></h2>
<div aria-label="<?php esc_attr_e( 'Main navigation', 'elayne' ); ?>">
<?php echo wp_kses_post( __( '<strong>Bold text</strong> to translate', 'elayne' ) ); ?>
```

An unescaped `<?php echo get_theme_file_uri('image.jpg'); ?>` looks harmless and fails every coding-standards check.

## Make the text translatable

Every user-facing string goes through a translation function that also escapes, with the theme's text domain as the second argument:

```php
<?php esc_html_e( 'Get started', 'elayne' ); ?>
<?php echo esc_html__( 'Read more', 'elayne' ); ?>
<?php echo esc_attr__( 'Close menu', 'elayne' ); ?>
```

Do not translate strings built by concatenation, because translators need the whole sentence. Use placeholders:

```php
<?php
/* translators: %s: author name */
printf( esc_html__( 'Written by %s', 'elayne' ), esc_html( $author ) );
?>
```

## Accessibility is part of the pattern

- Real alt text on every image, escaped, not `alt=""` on an image that carries meaning.
- Semantic tags: `header`, `main`, `section`, `footer` through the Group block's `tagName`, not a pile of `div`s.
- `aria-label` where a landmark appears more than once, such as two `nav` elements.

## Native blocks, not HTML blocks

`<!-- wp:html -->` makes the content uneditable in the block editor and breaks pattern editing. Reach for Group, List and Separator with CSS classes instead.

## Check the output by machine

The block serialisation is strict: if the comment attributes and the saved HTML differ, the editor reports "block validation failed" and offers to recover the block. Padding declared in the comment JSON that is missing from the rendered `style` attribute is the classic case. Instead of finding these in the browser, round-trip the file through WordPress's own parser:

```bash
wp imagewize pattern-validate web/app/themes/your-theme/patterns/ --diff
wp imagewize pattern-validate web/app/themes/your-theme/patterns/ --fix
```

That command uses `parse_blocks()` and `serialize_blocks()`, so what `--fix` writes back is the canonical form WordPress itself would store after a save. It lives in the wp-ops repository and is registered through `wp-cli.yml` in the Bedrock site root.

## Checklist

- [ ] Header has Title, Slug (namespaced), Description and registered Categories
- [ ] `metadata` matches the header exactly, with slugs not IDs
- [ ] No query-dependent PHP anywhere in the file
- [ ] Images come from the theme, with no hard-coded media IDs
- [ ] Every printed value escaped; every string translatable with the text domain
- [ ] Alt text, semantic tags and native blocks only
- [ ] `pattern-validate` run with no differences

---

*Maintain a pattern library of your own, or check these rules differently? Find me on Mastodon at [@jfrumau@mastodon.social](https://mastodon.social/@jfrumau).*
