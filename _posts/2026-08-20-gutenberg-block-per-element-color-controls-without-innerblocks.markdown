---
layout: post
title: "Two Colors, One Gutenberg Block, No InnerBlocks in Sight"
date: 2026-08-20 09:00:00 +0700
categories: wordpress gutenberg blocks javascript
tags: [wordpress, javascript, gutenberg, blocks, react, block-editor]
case_category: frontend
case_status: documented
---

While adding color controls to a small Gutenberg block — a single "stat" tile, a big number sitting over a caption, the sort of thing you'd repeat three or four times in a stats band on a homepage — I ran into a gap `supports.color` doesn't cover: the block has **two** independently colorable pieces of text, not one.

What follows is the pattern I landed on, why InnerBlocks — the obvious alternative — doesn't fit, and the drift trap that eventually forced the code into its own module.

## The Block

`Stat Item` renders two things: a number, and beneath it, a caption.

```jsx
<div { ...blockProps }>
  <RichText tagName={ NumberTagName } value={ number } /* … */ />
  <RichText tagName="div" value={ caption } /* … */ />
</div>
```

On paper, the ask was simple: let an editor set the number to the theme's accent color while leaving the caption at the default text color — or the reverse — independently, per stat. Two colors, one block.

## Why `supports.color` Doesn't Reach This

The standard route to color controls is `supports.color` in `block.json` — what `core/paragraph` and its siblings use, and where most tutorials stop. It hands you a `PanelColorSettings` panel for free, and `useBlockProps()` quietly attaches the right class and style to whatever element you spread it onto.

The catch is that it colors **the block**, singular — one wrapper, one pair of `textColor`/`backgroundColor` attributes. No supports flag exists for "this block has two text runs, each needing its own color," because core has never needed one — a paragraph is a single run of text, so is a heading. A stat tile isn't; it's two.

So two colors turned into four attributes:

```json
"numberColor": { "type": "string" },
"customNumberColor": { "type": "string" },
"captionColor": { "type": "string" },
"customCaptionColor": { "type": "string" }
```

## Reimplementing Core's Convention, By Hand

The `slug`/`custom` split isn't an arbitrary choice — it's the exact pair core stores for every colorable block. A palette pick is saved as a **slug** (`"accent"`); a manual pick, as a **CSS value** (`"#ff6600"`); only ever one of the two. Why keep both rather than collapsing to a single resolved color? A slug renders as `has-accent-color` and *follows the theme* — switch the active style variation, and the stat recolors right along with it. A literal hex value can't; it's frozen the moment it's saved.

Reproducing that behavior across two elements instead of one meant writing, by hand, the class-name/inline-style logic that `useBlockProps()` usually hides:

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

`getColorClassName( 'color', slug )` is the same core helper that turns `"accent"` into `has-accent-color` — reused rather than reinvented, so the output matches byte-for-byte what a native `supports.color` block would produce for a single element. The `has-text-color` marker class earns its place too: it's what gives the color enough CSS specificity to beat the parent band's own rules without resorting to `!important`.

## The Edit/Save Drift Trap

Gutenberg validates a block by re-running its `save()` function against whatever's already stored, then diffing the two. Both `edit.js` (the live editor preview) and `save.jsx` (the serialized markup) call `getStatColorProps()` with identical attributes:

```js
// edit.js
const numberProps = getStatColorProps( 'stat-rail__num', numberColor, customNumberColor );

// save.jsx — same call, same file
const numberProps = getStatColorProps( 'stat-rail__num', numberColor, customNumberColor );
```

Had that logic been written twice — loosely, in each file separately, the way it's easy to do when you're just trying to get a color to show up at all — the two copies *would* drift, eventually. Someone fixes an edit.js bug, tweaks the class order, and forgets save.jsx exists. The result isn't a visual bug you'd spot in a screenshot; it's a hard block-validation error the instant a reviewer opens the post, because the stored HTML no longer matches what `save()` produces today.

Moving the shared logic into `colors.js`, with both files importing the same function, makes that drift structurally impossible instead of merely something to remember. One function, one behavior, two call sites.

A second helper ended up in the same file, for the same reason — keeping edit and save in lockstep:

```js
export function getNumberTagName( level ) {
  return level >= 1 && level <= 6 ? `h${ level }` : 'div';
}
```

`level` is a plain block attribute, running 0 through 6. At `0`, the number renders as a `div`; a stats band is usually decorative, and turning three big figures into `<h1>`–`<h6>` elements dumps them straight into the page's document outline and the screen-reader heading list — rarely what "0.9s" or "24/7" is meant to signify semantically. Levels 1 through 6 cover the case where the band genuinely *is* the section's structure. Small as it is, the principle's the same: an attribute-driven choice both `edit.js` and `save.jsx` must resolve identically belongs in the shared module too.

## Why Not InnerBlocks?

The InnerBlocks alternative — nesting a `core/heading` and a `core/paragraph` inside the stat, each carrying its own native color support — sounds like it ought to just work. It's worth spelling out why it doesn't fit:

- **The content isn't freeform.** A stat is always exactly a number and a caption — never a third block, never a paragraph standing in for the number. Two string attributes model that fixed shape more honestly than an open-ended child list would.
- **`level: 0` has no InnerBlocks equivalent.** `core/heading` always renders as some `h1`–`h6`; there's no "plain div" mode to fall back on. Swapping which block type a child uses, based on an attribute, isn't something InnerBlocks supports.
- **It multiplies the drift surface rather than removing it.** Nesting real heading/paragraph blocks drags their *own* color and spacing supports along — their own classes, their own inline styles — stacked on top of, and potentially clashing with, the stat's own CSS. That's more moving parts to keep in sync, not fewer.

Two `RichText` fields plus a shared pure-function helper turned out to be the smaller surface area — not the larger one.

## The Pattern, Generalized

Whenever a block needs more than one independently colorable — or otherwise attribute-driven — element:

1. Give each element its own `slug`/`custom` attribute pair, matching core's convention instead of inventing a fresh one.
2. Write the attributes → className/style logic **once**, using `getColorClassName()` on the slug branch so the output matches what a native `supports.color` block would produce.
3. Import that single function from both `edit.js` and `save.jsx` — never re-derive the same class/style logic separately in each file.
4. If an attribute changes which *tag* gets rendered, not just its class or style, that resolution belongs in the shared module too — anything both files must agree on belongs there.

`supports.color` covers the common case. The moment a block needs two, this is what closing the gap looks like — without drifting into a validation error six months down the line.

---

*Hit a similar Gutenberg gap? Find me on Mastodon at [@jfrumau@mastodon.social](https://mastodon.social/@jfrumau).*
