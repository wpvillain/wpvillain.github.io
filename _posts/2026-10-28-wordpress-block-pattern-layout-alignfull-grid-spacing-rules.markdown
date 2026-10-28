---
layout: post
title: "Block Pattern Layout Rules That Prevent Gaps and Validation Errors: alignfull Groups, Grids, Spacing Variables and Margin Resets"
date: 2026-10-28 23:55:00 +0700
categories: wordpress gutenberg theme-development
tags: [wordpress, gutenberg, block-patterns, layout, theme-json, css-grid, block-themes, fse]
case_category: development
case_status: documented
---

Layout bugs in block patterns have a recognisable look: a thin gap between two coloured sections, a hero that overflows sideways, a three-column grid that jumps from three columns to one on a tablet. They come from a few structural habits, and once you follow them the patterns stack cleanly.

This is the companion to [the post on pattern files, headers and escaping]({% post_url 2026-10-28-wordpress-block-pattern-php-files-headers-escaping-images %}). It covers structure and styling. The rules were distilled from the Elayne and Ollie theme patterns, about 140 files.

## Full-width sections: two groups, two layouts

A background that runs edge to edge needs an outer group set to full width and an inner group that limits the content.

```html
<!-- wp:group {
  "align": "full",
  "layout": {"type": "default"},
  "backgroundColor": "primary",
  "style": {"spacing": {
    "margin": {"top": "0", "bottom": "0"},
    "padding": {"top": "var:preset|spacing|x-large", "bottom": "var:preset|spacing|x-large"}
  }}
} -->
<div class="wp-block-group alignfull has-primary-background-color has-background">

  <!-- wp:group {"layout": {"type": "constrained", "contentSize": "800px"}} -->
  <div class="wp-block-group">
    <!-- centred content -->
  </div>
  <!-- /wp:group -->

</div>
<!-- /wp:group -->
```

The rule that matters: the **outer `alignfull` group uses `"layout":{"type":"default"}`**. Giving it `"type":"constrained"` as well is the usual cause of horizontal gaps and overflow. The constraint belongs on the group inside it, with a `contentSize` of 800px, 900px or 1200px depending on how wide the text should run.

In short: an alignfull group with the default layout, then a constrained group, then the content.

## Reset the vertical margin

Block themes add `margin-block-start` between blocks. Between two full-width sections with different backgrounds, that margin shows as a stripe of page background. Any pattern with a background colour and `align` set to `full` or `wide` should say so explicitly:

```json
"style": {"spacing": {"margin": {"top": "0", "bottom": "0"}}}
```

Setting it inline in the block, rather than overriding it in CSS, keeps the behaviour visible in the markup where the next person looks.

## Grids, not Columns, for responsive card layouts

The Columns block collapses from its full width straight to one column, so a three-column section goes 3, 3, 1 across desktop, tablet and phone. That cramps the tablet. For feature grids, pricing tables, team lists and reviews use a Group with a grid layout:

```html
<!-- wp:group {
  "align": "wide",
  "layout": {"type": "grid", "minimumColumnWidth": "20rem"}
} -->
<div class="wp-block-group alignwide">
  <!-- cards -->
</div>
<!-- /wp:group -->
```

The grid fits as many columns as the width allows, each at least `20rem`, so it goes 3, 2, 1 on its own without a media query.

## Constrained inner groups

Text blocks inside a section should sit in a constrained group so line length stays readable and the content centres. Do not set `contentSize` on the outer alignfull group; nest it, as above.

## Spacing and colour come from the theme

Every spacing and colour value should be a theme.json variable, never a literal. In block attributes:

```json
"padding": {"top": "var:preset|spacing|large"}
"backgroundColor": "primary"
```

WordPress converts these to `var(--wp--preset--spacing--large)` and the class `has-primary-background-color` on save. Spacing presets in these themes are fluid (`clamp()` based), running from `small` at roughly 0.5 to 1rem up to `xxx-large` at roughly 6 to 10rem. Colours are semantic names, not values: `primary`, `main`, `base`, `secondary`, `tertiary`, `border-light`, `border-dark`.

A hard-coded `#f0f0f0` or `24px` breaks as soon as the site owner changes the palette or a child theme overrides a preset.

One validation trap here: `backgroundColor`, `layout` and `align` are **root-level** attributes. Nesting them inside the `style` object (`"style":{"backgroundColor":"base"}`) fails block validation. Padding, margin, border and typography go inside `style`.

## Border radius

Cards and buttons look wrong with sharp corners next to rounded ones. Pick one or two values from the theme (`5px` for cards and `8px` for larger boxes, for example) and use them consistently:

```json
"border": {"radius": "5px"}
```

## Typography

Use the font-size presets and font families from theme.json:

```json
"fontSize": "x-large"
"fontFamily": "heading"
```

Avoid `"fontSize":"16px"`. If you need a value that is not a preset, use `clamp()` so it scales. Inline typography styles are for the few cases a preset cannot cover.

## Match the comment JSON to the saved HTML

The editor compares the block comment attributes with the HTML. Declare padding or a border in the JSON and the rendered element needs the matching `style` attribute, or the block fails validation and the editor offers a recovery. This is the thing hand-written patterns get wrong most. Writing the markup in the editor and copying it out avoids it, and [pattern-validate]({% post_url 2026-10-28-wordpress-block-pattern-php-files-headers-escaping-images %}) catches the rest.

## Different pattern shapes

- **Full-width backgrounds** (heroes, CTAs, testimonials): the two-group structure above, margin reset, theme presets.
- **Cards and boxes:** a Group with padding, a theme colour, a radius, and an optional border from `border-light`.
- **Feature grids:** the grid layout with `minimumColumnWidth`.
- **Template patterns** (headers, footers, 404): include the template-type fields in the header and keep them out of the inserter.
- **Query patterns:** use the Query Loop and post blocks, with `post-featured-image` sized by a named image size and an `aspectRatio`.

## Categories

Register your pattern categories in `functions.php` and use the namespaced slug everywhere: header, metadata, and the pattern slug itself. A pattern in `elayne/hero` does not appear under a category registered as `hero`.

## The mistakes in one list

1. Outer alignfull group with a constrained layout.
2. `wp:columns` for a responsive grid.
3. Hard-coded colours, pixel sizes or media IDs.
4. No margin reset on a background section.
5. Root attributes (`backgroundColor`, `layout`, `align`) nested under `style`.
6. Block JSON that does not match the rendered HTML.
7. `wp:html` blocks in place of native blocks.
8. Inconsistent section spacing: mix `large` and `x-large` at random and the page loses its rhythm.

---

*Have a rule I missed, or one you disagree with? Find me on Mastodon at [@jfrumau@mastodon.social](https://mastodon.social/@jfrumau).*
