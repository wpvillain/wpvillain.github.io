---
layout: post
title: "WordPress Mobile Menu Overlay Styling and the Headless Chrome Trap"
date: 2026-09-23 10:00:00 +0700
categories: wordpress css devops testing
tags: [wordpress, gutenberg, block-theme, mobile-menu, overlay, css, headless-chrome, playwright, testing]
case_category: devops
case_status: shipped
---

{% raw %}
If you've ever styled a WordPress block theme's mobile navigation overlay and wondered why your 375px-wide screenshot shows a hamburger clipped off-screen while the live site works fine, this one's for you. A recent fix for the Ecotuin theme — matching the light header's mobile overlay to the approved v3e design — turned into a lesson about viewport testing, CTA placement in `core/navigation`, and a Chrome flag that silently lies to you.

## The Visual Problem

Issue #9 was straightforward on the surface: on phones, the light header's mobile menu overlay rendered with core's default unstyled look — white background, black text, right-aligned links, no dividers — none of which matched the rest of the site's chalk-and-ivy palette. The design called for a `base` (chalk) background, `secondary` (ivy-green) Roggenkamp typography, left-aligned links with rule-coloured (`border-light`) dividers between them, and a full-width Contact CTA button below the links.

Simple enough. The overlay needed restyling, the links needed left-aligning, and the CTA needed appending. What wasn't obvious: headless Chrome would spend the better part of a debugging session convincing us the header itself was broken.

## The First Hurdle: Testing the Overlay at All

Mobile overlays are stateful — the hamburger has to be clicked to open them, and core's responsive container only switches into its fixed-position modal once the viewport is narrow enough for `overlayMenu: "mobile"` to kick in. That means:

- You can't test the *closed* state at desktop width and infer the open one
- You can't force the state with a class toggle and trust the CSS is identical to what the real click produces
- You need an actual narrow viewport *and* a real click

Static HTML snapshots or DOM hacks that toggle `is-menu-open` miss any JavaScript that runs during the real transition. A real interaction test, at a real phone width, was the only reliable check.

## Enter Headless Chrome

My first instinct was the usual headless Chrome one-liner:

```bash
chrome --headless=new --window-size=390,700 --screenshot=/tmp/ecotuin-390.png https://ecotuin.test/
```

Then click the hamburger via DevTools Protocol or a small Puppeteer script, wait for the overlay to open, screenshot again. Standard workflow.

What I got back looked alarming: between 375px and 430px, the header's right edge overflowed the viewport and the hamburger icon was clipped off-screen. The overlay itself was fine once open, but the trigger to open it was unreachable. That suggested the header's padding or the icon's positioning was fundamentally broken at those widths.

Except it wasn't. A manual check on a real iPhone showed the hamburger sitting exactly where it should. Retesting with [Playwright](https://playwright.dev/) at the same viewport widths confirmed: no overflow, no clipping, hamburger fully visible and tappable. The bug didn't reproduce at all.

## The Footgun: `--window-size` Below ~500px

The culprit, documented in the project's internal CLAUDE.md notes: **headless Chrome silently ignores viewport widths below roughly 500px** when launched via `--window-size`. It renders at a wider width instead (around 500px minimum, inconsistently), and doesn't tell you it's doing so. The screenshot you get back *looks* plausible — it's a real render, just not at the width you asked for — and if your layout has a breakpoint or overflow issue between 375px and 500px, you'll never see it in that test.

In our case, the lie was the opposite direction: the screenshot showed an overflow that didn't exist at the requested 375px, because Chrome was actually rendering at ~500px where the header *did* fit. The phantom bug sent us down a rabbit hole of header padding checks and icon positioning that all looked fine in isolation, because the real problem was the testing tool itself.

Playwright's `viewport: { width, height }` parameter, by contrast, is exact — pass 390 and it renders at 390, every time. And because `node_modules/playwright` already exists (pulled in by [wp-pattern-sentinel](https://github.com/imagewize/wp-pattern-sentinel)), there's no extra install step:

```js
const { chromium } = require('/Users/…/ecotuin/node_modules/playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 700 } });
await page.goto('https://ecotuin.test/', { waitUntil: 'networkidle' });
await page.click('.wp-block-navigation__responsive-container-open');
await page.screenshot({ path: '/tmp/overlay-open-390.png' });
```

That's the pattern we now use for any check where the actual viewport width matters below ~500px.

## The Second Hurdle: CTA Placement

The design's mobile dropdown ends with a full-width Contact button directly below the navigation links. In the Site Editor, those links live in a **separately-stored Navigation menu** (the "Diensten / Werkwijze / Projecten / ..." items), not inline in the template part. `core/navigation` has a quirk: it only renders its referenced menu when the block has **no inner blocks of its own**. If you add inner blocks to the nav in `parts/header.html` — say, a `core/buttons` block for the CTA — WordPress *replaces* the referenced menu with those inner blocks instead of appending to it. The real links disappear.

That meant the CTA couldn't be part of the template part's markup. Two options remained:

1. **Add the CTA link to the Navigation menu itself** in the WordPress admin. Simple, but it pollutes the menu's desktop presentation (an extra "Contact" item in the inline nav at desktop width) and the client would see it as a menu item they could reorder or remove.

2. **Append the CTA via a filter after rendering.** `render_block_core/navigation` fires after WordPress has assembled the block's HTML from its referenced menu, so we can inject additional markup at that point without touching what the block stores.

We went with option 2. The function scopes itself to the light header's nav via a className (`ecotuin-header__nav`), appends a full-width button block right after the `</ul>`, and lets CSS hide it everywhere except the open overlay:

```php
function ecotuin_header_nav_cta( $block_content, $block ) {
    $class_name = $block['attrs']['className'] ?? '';

    if ( false === strpos( $class_name, 'ecotuin-header__nav' ) ) {
        return $block_content;
    }

    $cta = sprintf(
        '<div class="wp-block-buttons ecotuin-header__overlay-cta"><div class="wp-block-button wp-block-button__width-100"><a class="wp-block-button__link wp-element-button" href="%s">%s</a></div></div>',
        esc_url( home_url( '/contact/' ) ),
        esc_html__( 'Contact', 'ecotuin' )
    );

    return preg_replace( '#</ul>#', '</ul>' . $cta, $block_content, 1 );
}
add_filter( 'render_block_core/navigation', __NAMESPACE__ . '\ecotuin_header_nav_cta', 10, 2 );
```

CSS then hides it by default and only shows it inside the open overlay:

```css
.ecotuin-header__overlay-cta {
    display: none;
}

.ecotuin-header:not(.ecotuin-header--dark) .wp-block-navigation__responsive-container.is-menu-open .ecotuin-header__overlay-cta {
    display: flex;
    margin-top: var(--wp--preset--spacing--small);
}
```

## The CSS Fixes: Alignment and Full-Width Links

With the CTA in place, the styling itself fell into three pieces:

### 1. Raising the Breakpoint

Core hardcodes `overlayMenu: "mobile"` to collapse at 600px. Between 600px and 1024px, the inline nav competed with the wordmark, cart/account icons, and CTA, wrapping the masthead to 105px tall on tablets. We raised the effective breakpoint to 1024px by re-declaring the two core rules that switch the container between overlay and inline:

```css
@media (min-width: 600px) and (max-width: 1023px) {
    .ecotuin-header .wp-block-navigation__responsive-container:not(.hidden-by-default):not(.is-menu-open) {
        display: none;
    }

    .ecotuin-header .wp-block-navigation__responsive-container-open:not(.always-shown) {
        display: flex;
    }
}
```

### 2. Left-Aligning Links and Full-Width Dividers

Core's overlay right-aligns the link list via `align-items: flex-end` in two places: on the container-content and on each navigation item. That shrink-wraps each `<li>` to its text width and pins it to the right edge — fine for a right-aligned desktop nav, but not what the design called for.

Design v3e uses `display: block` for mobile list items, so each one spans the full width and the divider border runs edge-to-edge. We reproduced that with `align-items: stretch` in both locations, then added `text-align: left` to position the text within the now full-width box:

```css
.ecotuin-header .wp-block-navigation__responsive-container.is-menu-open .wp-block-navigation__responsive-container-content,
.ecotuin-header .wp-block-navigation__responsive-container.is-menu-open .wp-block-navigation__container,
.ecotuin-header .wp-block-navigation__responsive-container.is-menu-open .wp-block-navigation-item {
    align-items: stretch;
}

.ecotuin-header .wp-block-navigation__responsive-container.is-menu-open .wp-block-navigation__container {
    text-align: left;
}
```

### 3. Styling to Match v3e Design

Finally, the visual restyling to match the design's mobile dropdown:

```css
/* Chalk background, ivy text */
.ecotuin-header:not(.ecotuin-header--dark) .wp-block-navigation__responsive-container.is-menu-open {
    background-color: var(--wp--preset--color--base) !important;
    color: var(--wp--preset--color--secondary) !important;
}

/* Rule-coloured dividers between links */
.ecotuin-header:not(.ecotuin-header--dark) .wp-block-navigation__responsive-container.is-menu-open .wp-block-navigation-item__content {
    border-bottom: 1px solid var(--wp--preset--color--border-light);
    font-size: 1.25rem;
    padding-block: 0.75rem;
}

/* Remove the underline that works as a divider on desktop */
.ecotuin-header .wp-block-navigation__responsive-container.is-menu-open .wp-block-navigation-item__content::after {
    content: none;
}
```

The `!important` flags are necessary because core emits its own `!important` selectors for color handling on navigation blocks without explicit background/text colors.

## The Takeaways

1. **Don't trust headless Chrome below ~500px width.** Use Playwright for any narrow-viewport check where the exact width matters. It's already a dependency in many WordPress projects via pattern validation or other tooling, so there's often no extra setup.

2. **`core/navigation` replaces referenced menus with inner blocks.** If your nav references a separately-stored menu and you need to add content to it (like a CTA button that only appears in the overlay), do it via `render_block_core/navigation`, not by editing the template part's markup.

3. **Overlay state needs real interaction.** Static snapshots or class toggles miss JavaScript that runs during the real transition. A real click test at the real width is the only way to be sure.

4. **Core's overlay CSS makes assumptions about alignment.** It right-aligns for a right-anchored desktop nav, which doesn't translate cleanly to left-aligned mobile designs. Overriding `align-items` and `text-align` together gets you full-width items with left-aligned text.

5. **Document the footguns.** We added the headless Chrome warning to the project's internal CLAUDE.md notes so the next person (or the next project) doesn't repeat the same time sink. Small notes like that pay for themselves the first time someone else hits the same issue.

## What This Looked Like in Practice

The PR that shipped this (#10) touched eight files across six commits:

- `parts/header.html` — added `ecotuin-header__nav` className for scoping
- `functions.php` — the `render_block_core/navigation` filter for CTA injection
- `style.css` — breakpoint raise, alignment fixes, color palette application, CTA visibility toggles
- `CLAUDE.md` — the headless Chrome footgun documentation
- Version files: `style.css` header, `readme.txt`, `package.json`, `CHANGELOG.md`

Total: ~185 lines added/modified, with the actual overlay styling being a minority of the effort. The rest was testing infrastructure and placement mechanics.

This is the kind of careful, edge-case-aware WordPress work we do at [Imagewize](https://imagewize.com). If you're building block themes and hitting surprising layout or testing issues — or just want to avoid the headless Chrome trap on your next responsive check — [get in touch](https://imagewize.com/contact-us/).

---

*Questions about block theme navigation or mobile overlay testing? Find me on Mastodon at [@jfrumau@mastodon.social](https://mastodon.social/@jfrumau).*
{% endraw %}
