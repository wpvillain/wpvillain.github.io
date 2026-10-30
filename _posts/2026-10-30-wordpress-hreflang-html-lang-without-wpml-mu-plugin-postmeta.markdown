---
layout: post
title: "Hreflang and html lang for Dutch, German and English WordPress Pages Without WPML: A Postmeta-Driven mu-plugin"
date: 2026-10-30 11:30:00 +0700
categories: wordpress seo multilingual
tags: [wordpress, hreflang, multilingual, seo, mu-plugin, wp-cli, bedrock, trellis]
case_category: development
case_status: shipped
---

A site that is mostly English with a handful of Dutch and German pages does not need WPML or Polylang. It needs two things: the right `<html lang>` on the translated pages, and `hreflang` alternate links between pages that are translations of each other. I had both in a small mu-plugin, but every new translation meant editing the plugin and redeploying. This is how I changed it so a new translation is two WP-CLI commands.

## What the old plugin did

Each language cluster had its own hardcoded `add_action('wp_head', ...)` block with absolute URLs, and a separate array of slugs for the language attribute. Adding a Dutch page meant adding a block, adding a slug to the array, and deploying. Two problems showed up over time:

- The slug list and the hreflang blocks drifted apart. A page could have the right `lang` and no hreflang, or the other way round.
- The default WordPress locale is `en-US`, so a Dutch page missing from the list shipped `<html lang="en-US">`, which contradicts the page's own content.

## Two jobs, two different automations

The language attribute and the hreflang alternates look like one feature, but they automate differently.

**`<html lang>` can come from the slug.** If every Dutch page starts with `nl-` and every German page with `de-`, a prefix map is enough. No list to maintain.

**hreflang cannot come from the slug.** `/how-we-work/` pairs with `/nl-zo-werken-wij/`, and nothing in the two names says so. The pairing has to be stored somewhere. Post meta is the simplest place: each page gets a group name, and every page with the same group is a translation of the others.

## The plugin

Two meta keys do the work. `_hreflang_group` is any string shared by the translations. `_hreflang_locale` overrides the locale, and is only needed on the English member because the slug prefix covers the rest.

```php
const IMAGEWIZE_HREFLANG_PREFIXES = [
    'nl-' => 'nl-NL',
    'de-' => 'de-DE',
];

function imagewize_hreflang_locale(int $post_id): ?string
{
    $locale = get_post_meta($post_id, '_hreflang_locale', true);

    if ($locale) {
        return $locale;
    }

    $slug = get_post_field('post_name', $post_id);

    foreach (IMAGEWIZE_HREFLANG_PREFIXES as $prefix => $prefix_locale) {
        if (str_starts_with($slug, $prefix)) {
            return $prefix_locale;
        }
    }

    return null; // the site default
}
```

The alternates for a post are every published post in the same group, keyed by locale, plus `x-default`:

```php
function imagewize_hreflang_alternates(int $post_id): array
{
    $group = get_post_meta($post_id, '_hreflang_group', true);

    if (! $group) {
        return [];
    }

    $ids = get_posts([
        'post_type'      => 'any',
        'post_status'    => 'publish',
        'meta_key'       => '_hreflang_group',
        'meta_value'     => $group,
        'posts_per_page' => -1,
        'fields'         => 'ids',
    ]);

    if (! in_array($post_id, $ids, true)) {
        $ids[] = $post_id;
    }

    $urls = [];

    foreach ($ids as $id) {
        $hreflang = imagewize_hreflang_locale($id) ?: 'en';

        if (! isset($urls[$hreflang])) {
            $urls[$hreflang] = get_permalink($id);
        }
    }

    // English first, then alphabetical, so the output order is stable.
    uksort($urls, fn ($a, $b) => ($a === 'en' ? -1 : ($b === 'en' ? 1 : strcmp($a, $b))));

    $urls['x-default'] = $urls['en'] ?? home_url('/');

    return $urls;
}
```

Two hooks print it and set the language:

```php
add_action('wp_head', function () {
    if (! is_singular()) {
        return;
    }

    foreach (imagewize_hreflang_alternates(get_queried_object_id()) as $hreflang => $url) {
        echo '<link rel="alternate" hreflang="'.esc_attr($hreflang).'" href="'.esc_url($url).'" />'."\n";
    }
});

add_filter('language_attributes', function ($output) {
    if (! is_singular()) {
        return $output;
    }

    $locale = imagewize_hreflang_locale(get_queried_object_id());

    if (! $locale || $locale === 'en') {
        return $output;
    }

    return preg_replace('/lang="[^"]*"/', 'lang="'.esc_attr($locale).'"', $output);
});
```

Every member of a group prints the full set. hreflang needs return links: if the English page lists the Dutch page, the Dutch page has to list the English one back, or the annotation can be ignored.

## Adding a translation

```bash
# English page and its Dutch translation
wp post meta update 14206 _hreflang_group how-we-work --path=web/wp
wp post meta update 14206 _hreflang_locale en --path=web/wp
wp post meta update 14207 _hreflang_group how-we-work --path=web/wp
```

The Dutch page gets `nl-NL` from its `nl-` slug. A Dutch page with no English counterpart needs a group of its own with one member. It prints its own `nl-NL` plus an `x-default` pointing at the home page, which matches what the hardcoded version did for such pages.

A page with a prefix but no group, for example a German-only compliance post, still gets the correct `<html lang>` and no hreflang. That is intended: hreflang alternates should be genuine equivalents of each other.

## Migrating without losing tags

The order matters when you move from a hardcoded plugin to this one. Set the meta first, then deploy the plugin. The old plugin ignores the meta, so setting it early is safe. If you deploy first, the hreflang tags disappear until the meta exists.

Post IDs differ between local and production, so the migration script looks pages up by slug:

```php
$id = (int) (get_posts([
    'name'           => $slug,
    'post_type'      => 'any',
    'post_status'    => 'publish',
    'fields'         => 'ids',
    'posts_per_page' => 1,
])[0] ?? 0);
```

Run it with `wp eval-file`, with a dry-run argument first. The front page has no slug, so it is looked up from the `page_on_front` option.

## Checking it

Before changing anything, I saved the `<html>` tag and the hreflang links for 13 URLs, then compared after the deploy. The command is one loop:

```bash
for u in "" how-we-work nl-zo-werken-wij; do
  echo "## /$u/"
  curl -s -L "https://example.com/$u/" \
    | grep -o -E '<html[^>]*>|<link rel="alternate" hreflang[^>]*>' | sort
done
```

On my site every `lang` attribute and every hreflang set matched, with one deliberate change: the English page of a pair that had only emitted tags on the Dutch side now emits them too. Compare local against production with the host rewritten, since `get_permalink()` now returns the local URL.

## Limits

- This covers single posts and pages. Archives, a blog index and taxonomy pages get nothing, because they have no per-page group.
- It runs one `get_posts` query on each view of a grouped page. With page caching in front, that cost is small, and I have not measured it without a cache.
- It does not touch `og:locale`. The SEO plugin on my site still outputs `en_US` on Dutch pages, which is a separate fix.
- It will not help if you need a language switcher, translated menus, or translations managed inside the editor. That is what WPML and Polylang are for.
- I have used this on one single-site install, not on multisite.
- hreflang is a hint to search engines, not a ranking boost. I have not measured any traffic effect from it.

If you are weighing the two approaches: a few hand-made translated pages with their own slugs fit this. A site that will translate every page into several languages does not.
