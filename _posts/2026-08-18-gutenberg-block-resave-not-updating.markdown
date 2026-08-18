---
layout: post
title: "I Shipped a Gutenberg Block Update, Clicked Save, and Nothing Changed"
date: 2026-08-18 16:00:00 +0700
categories: wordpress php gutenberg debugging
tags: [wordpress, php, gutenberg, blocks, debugging, rest-api, javascript]
case_category: debugging
case_status: resolved
---

I added a new section to a custom Gutenberg block, deployed the plugin update, opened the page that uses the block, and clicked **Save**. The front end kept showing the old markup — no error, no warning, just silence.

What follows is the record of two wrong guesses, the actual cause, and the two-line browser console fix that finally got the page to reflect the new code.

## The Scenario

The block in question is a **static** Gutenberg block: its `save()` function outputs real HTML, and WordPress bakes that HTML straight into `post_content` at save time. There's no `render_callback`, so the front end simply echoes whatever's already sitting in the database. That's the standard behavior for any block registered with:

```php
register_block_type($this->pluginPath('/build/my-block'));
```

and no `render_callback` argument.

I'd added a fourth card to what had been a row of three in the block's `save.jsx`, rebuilt the JS, shipped the update, and confirmed the plugin version had bumped correctly. Then I opened the page already using that block, expecting the new card to show up the moment I re-saved.

Nothing happened.

## First Guess: Caching

Caching seemed like the obvious culprit — a stale JS bundle somewhere, an object cache still holding old post data, a page cache serving a pre-deploy snapshot. A reasonable first guess, and wrong this time.

I ruled it out step by step:

```js
// In the browser console, check what script actually loaded:
Array.from(document.querySelectorAll('script[src*="my-block"]'))
  .map(s => s.src);
// → ".../my-block/index.js?ver=<content-hash>"
```

The `?ver=` query string turned out to be a webpack content hash, and it matched what was in the freshly-built `index.asset.php`. So the current JavaScript really was loading. I went further and flushed every cache I could find — object cache, transients, PHP opcache — then hard-reloaded the editor. Still three cards, not four.

## Second Guess: The Editor Needs a "Real" Edit

Theory two: maybe Gutenberg only re-serializes a block when something about it genuinely changes, and hitting Save on an otherwise-untouched block is a no-op. To test that, I clicked into a text field, pressed End, typed a space, then deleted it — an edit that leaves the final text exactly where it started. Then Save.

The "Page updated" toast appeared right on cue. Three cards, still.

At that point, guessing wasn't going to get me any further — it was time to prove, directly, what the editor actually thought the block should serialize to.

## Proving It From the Console

Gutenberg's block editor state is queryable directly from the browser console on any `wp-admin` post edit screen:

```js
const blocks = wp.data.select('core/block-editor').getBlocks();
const analyzer = blocks.find(b => b.name === 'my-plugin/my-block');
const serialized = wp.blocks.serialize(analyzer);
serialized.match(/card-label">[A-Za-z ]*</g);
// → ["card-label\">One<", "card-label\">Two<", "card-label\">Three<", "card-label\">Four<"]
```

Four cards, right there in the console. Serializing the in-memory block state manually, through the real `wp.blocks.serialize()` function, produced exactly the output the new code should. Deployed code: correct. Loaded JS: correct. The editor's own block state: also correct.

The one thing that wasn't correct was whatever "Save" had actually written to the database.

## The Real Cause

My space-then-backspace edit landed back on the exact same string it started with, and Gutenberg's dirty-tracking never registered that as a change worth persisting. So clicking Save resubmitted the **original stored HTML** unchanged, rather than a fresh serialization of the current block state. A real save did fire — the post's `modified` timestamp moved, the revision count went up — it just never regenerated the content, because as far as the editor was concerned, nothing had changed.

That's what makes this one easy to miss: every visible signal insists it worked. The toast confirms, the revision count climbs, the modified date updates. None of it tells you the HTML string itself is byte-identical to what was already there.

## The Fix

`wp.blocks.serialize()` had already proven I could get the correct markup on demand, so the fix was to push that straight to the REST API — skipping the editor's save button, and its dirty-check, entirely:

```js
const blocks = wp.data.select('core/block-editor').getBlocks();
const full = wp.blocks.serialize(blocks);

const result = await wp.apiFetch({
  path: '/wp/v2/pages/<POST_ID>',
  method: 'POST',
  data: { content: full }
});

result.content.raw.match(/card-label">[A-Za-z ]*</g);
// → all four cards, confirmed in the response
```

Because it runs inside the same authenticated `wp-admin` tab, it reuses the existing REST nonce for free — `wp.apiFetch` is already loaded on every block editor screen, no extra setup required.

The front end confirmed the fix right away:

```bash
curl -s https://example.com/the-page/ | grep -o 'card-label">[A-Za-z ]*<'
```

Four cards.

## Why a "No-Op" Edit Isn't Reliable

Don't lean on the type-a-character-then-delete-it trick if you're trying to force a resave. Whether it counts as a "real" edit depends on exactly how the block's attribute is bound — a controlled `RichText` component, a plain `<input>`, a `TextControl` — and on how React/Gutenberg's undo-level tracking batches the before/after comparison. Sometimes it works. Sometimes, as here, it fails silently, and the failure gives you nothing to go on beyond a toast that looks exactly the same as a real save.

None of this applies if you have a genuine reason to change something — that's just a real edit. The trap only opens up when the goal is forcing a **regeneration of unchanged content** after a code deploy.

## The Rule

**A static Gutenberg block's stored `post_content` doesn't update itself when the block's code changes.** New plugin or theme code changes what a *fresh* save produces; it does nothing at all to pages where the block was already saved before the change. Getting an existing page to pick it up takes one of:

1. A genuine content edit in the editor, followed by Save.
2. A forced re-serialization from the console, the way shown above.
3. For many pages at once: this doesn't scale cleanly through PHP, since replicating a JS build's `save()` output server-side isn't trivial. The console/REST approach above is realistically a per-page tool — unless the block's markup is simple enough that a plain PHP string replace can stand in for it.

## Debugging Checklist

When a block-code change "isn't showing up" after a deploy, work through these in order:

| Check | How | Rules out |
|---|---|---|
| Is the new JS actually being served? | `document.querySelector('script[src*="..."]').src`, compare the `?ver=` hash to the current build | Stale CDN/cache |
| Does the editor's *current* block state serialize correctly? | `wp.blocks.serialize(wp.data.select('core/block-editor').getBlocks())` in the console | A code bug in `save()` |
| Did Save actually persist new content, or just resubmit the old string? | Compare the REST response's `content.raw` (or a fresh `curl` of the front end) against what step 2 produced | The dirty-check no-op trap this post is about |

Each check eliminates one whole category before you get anywhere near the actual cause.

## Conclusion

It took two wrong guesses — caching, then "give the editor a nudge" — before the real mechanism surfaced: Gutenberg quietly reusing unchanged content on save. Once identified, the fix was two lines in a browser console. What'll actually save time next time is the order of the checklist above: confirm the served code first, then the in-memory block state, then what actually got persisted — and don't take a success toast at its word.

---

*Run into a similar Gutenberg gotcha? Find me on Mastodon at [@jfrumau@mastodon.social](https://mastodon.social/@jfrumau).*
