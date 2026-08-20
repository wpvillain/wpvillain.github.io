---
layout: post
title: "Two Colors, One Gutenberg Block, No InnerBlocks in Sight"
date: 2026-08-20 09:00:00 +0700
categories: wordpress gutenberg blocks javascript
tags: [wordpress, javascript, gutenberg, blocks, react, block-editor]
case_category: frontend
case_status: documented
---

I was adding color controls to a small Gutenberg block — a single "stat" tile (a big number over a caption, the kind of thing you'd repeat three or four times in a stats band on a homepage) — and ran into a gap that `supports.color` doesn't cover: the block has **two** independently colorable pieces of text, not one.

Here's the pattern that came out of it, why the obvious InnerBlocks alternative doesn't fit, and the drift trap that forced the code into its own module.

## The Block

`Stat Item` renders two things: a number and a caption underneath it.

```jsx
<div { ...blockProps }>
  <RichText tagName={ NumberTagName } value={ number } /* … */ />
  <RichText tagName="div" value={ caption } /* … */ />
</div>
```

The ask was simple on paper: let an editor set the number to the theme's accent color while leaving the caption on the default text color, or vice versa, per stat. Two colors, one block.

## Why `supports.color` Doesn't Reach This

The usual way to get color controls onto a block is `supports.color` in `block.json` — it's what `core/paragraph` and friends use, and it's what most tutorials stop at. It gives you a `PanelColorSettings` panel for free, and `useBlockProps()` quietly adds the right class/style to whatever element you spread it on.

The catch: it colors **the block**, singular — one wrapper, one set of `textColor`/`backgroundColor` attributes. There's no supports flag for "this block has two text runs and each one needs its own color." Core doesn't need one, because no core block has that shape — a paragraph is one run of text, a heading is one run of text. A stat tile is two.

So the two colors had to become four attributes instead of two:

```json
"numberColor": { "type": "string" },
"customNumberColor": { "type": "string" },
"captionColor": { "type": "string" },
"customCaptionColor": { "type": "string" }
```

## Reimplementing Core's Convention, By Hand

The `slug`/`custom` split isn't arbitrary — it's the same pair core stores for every colorable block. A palette pick is stored as a **slug** (`"accent"`), a manual pick as a **CSS value** (`"#ff6600"`), and only one of the two is ever set. The reason to keep both instead of collapsing to one resolved color: a slug renders as `has-accent-color` and *follows the theme* — swap the active style variation and the stat re-colors with it. A literal hex value can't do that; it's frozen at save time.

Reproducing that behavior for two elements instead of one meant writing the class-name/inline-style logic that `useBlockProps()` normally hides:

```js
import { getColorClassName } from '@wordpress/block-editor';

export function getStatColorProps( baseClass, slug, custom ) {
  const classNames = [ baseClass ];

  if ( slug || custom ) {
    classNames.push( 'has-text-color' );
  }
  if ( slug ) {
    classNames.push( getColorClassName( 'color', slug ) );
  }

  return {
    className: classNames.join( ' ' ),
    style: custom ? { color: custom } : undefined,
  };
}
```

`getColorClassName( 'color', slug )` is the exact core helper that turns `"accent"` into `has-accent-color` — reused, not reinvented — so the output is byte-for-byte what a native `supports.color` block would produce for a single element. The `has-text-color` marker class matters too: it's what gives the color enough CSS specificity to win against the parent band's own rules without reaching for `!important`.

## The Edit/Save Drift Trap

Gutenberg validates a block by re-running its `save()` function against what's already stored and diffing the two. `edit.js` (the live editor preview) and `save.jsx` (the serialized markup) both call `getStatColorProps()` with the same attributes:

```js
// edit.js
const numberProps = getStatColorProps( 'stat-rail__num', numberColor, customNumberColor );

// save.jsx — same call, same file
const numberProps = getStatColorProps( 'stat-rail__num', numberColor, customNumberColor );
```

If that logic had been written twice — once loosely in each file, the way it's easy to do when you're just trying to get a color to show up — the two copies *will* drift eventually. Someone tweaks the class order fixing an edit.js bug and forgets save.jsx exists. The result isn't a visual bug you'd catch in a screenshot; it's a hard block-validation error the moment a reviewer opens the post, because the stored HTML no longer matches what `save()` would produce today.

Pulling the shared logic into `colors.js` and having both files import the same function makes that drift structurally impossible rather than a thing to remember. One function, one behavior, two call sites.

A second helper rode along in the same file for the same reason — keeping edit/save in lockstep:

```js
export function getNumberTagName( level ) {
  return level >= 1 && level <= 6 ? `h${ level }` : 'div';
}
```

`level` is a plain block attribute, 0 through 6. At `0` the number renders as a `div`; a stats band is usually decorative, and turning three big figures into `<h1>`–`<h6>` elements dumps them straight into the page's document outline and the screen-reader heading list — rarely what "0.9s" and "24/7" are supposed to mean semantically. Levels 1–6 exist for the case where the band genuinely *is* the section's structure. It's a small thing, but it's the same principle: an attribute-driven choice that both `edit.js` and `save.jsx` must resolve identically, so it lives in the shared module too.

## Why Not InnerBlocks?

The InnerBlocks alternative — a `core/heading` and a `core/paragraph` nested inside the stat, each with its own native color support — sounds like it should just work, and it's worth being explicit about why it doesn't fit here:

- **The content isn't freeform.** A stat is always exactly a number and a caption, never a third block, never a paragraph standing in for the number. Two string attributes model that fixed shape more honestly than an open-ended child list.
- **`level: 0` has no InnerBlocks equivalent.** `core/heading` is always some `h1`–`h6`; there's no "render as a plain div" mode. Swapping which block type a child uses based on an attribute isn't something InnerBlocks does.
- **It multiplies the drift surface, doesn't remove it.** Nesting real heading/paragraph blocks brings their *own* color and spacing supports along — their own classes, their own inline styles — stacked on top of, and potentially fighting, the stat's own CSS. More moving parts to keep synchronized, not fewer.

Two `RichText` fields with a shared pure-function helper turned out to be the smaller surface area, not the larger one.

## The Pattern, Generalized

Whenever a block needs more than one independently colorable (or otherwise attribute-driven) element:

1. Give each element its own `slug`/`custom` attribute pair, matching core's convention rather than inventing a new one.
2. Write the attributes → className/style logic **once**, using `getColorClassName()` for the slug branch so the output matches what a native `supports.color` block would produce.
3. Import that one function from both `edit.js` and `save.jsx` — never re-derive the same class/style logic in each file separately.
4. If an attribute changes which *tag* gets rendered (not just its class or style), that resolution belongs in the shared module too — anything both files must agree on, is.

`supports.color` handles the common case. The moment a block needs two, this is what filling the gap looks like without drifting into a validation error six months later.

---

*Run into a similar Gutenberg gap? Find me on Mastodon at [@jfrumau@mastodon.social](https://mastodon.social/@jfrumau).*
