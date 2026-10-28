---
layout: post
title: "Noindex WordPress Posts After an Expiry Date: Yoast's wpseo_robots Filter and the Site Timezone"
date: 2026-10-28 21:00:00 +0700
categories: wordpress seo php
tags: [wordpress, seo, yoast, noindex, php, timezone, wp-cli, custom-meta]
case_category: development
case_status: documented
---

Some posts have a shelf life. A race tip, an event preview or a limited offer is useful until the event happens, and then it is a stale page that still ranks. You do not want to delete it, because it has links, and you do not want to remember to noindex it by hand a week later.

This is a small snippet that adds a "Noindex After Date" field to the post editor and makes Yoast SEO output `noindex, follow` once the date has passed. It runs in the site's own timezone, which is the part that is easy to get wrong.

## What it does

Three pieces, all in `functions.php` or a small plugin:

1. A filter on Yoast's `wpseo_robots` that returns `noindex, follow` for expired posts.
2. A meta box in the post sidebar with a date input.
3. A `save_post` handler that stores the date.

`noindex, follow` takes the page out of search results but keeps its links crawlable, so the link equity it passes on is not cut off.

## The code

```php
add_filter( 'wpseo_robots', function( $robots ) {
	if ( ! is_singular( 'post' ) ) {
		return $robots;
	}

	// Limit to specific categories. Replace 0 with real category IDs, e.g. [12, 34].
	$expiry_categories = [ 0 ];

	if ( ! has_term( $expiry_categories, 'category' ) ) {
		return $robots;
	}

	$expiry_date = get_post_meta( get_the_ID(), '_post_expiry_date', true );
	if ( $expiry_date ) {
		$tz  = wp_timezone();                                    // Settings → General
		$now = new DateTime( 'now', $tz );
		$exp = new DateTime( $expiry_date . ' 00:00:00', $tz ); // Midnight, local time
		if ( $exp < $now ) {
			return 'noindex, follow';
		}
	}

	return $robots;
} );

add_action( 'add_meta_boxes', function() {
	add_meta_box(
		'post_expiry_date',
		'Noindex After Date',
		function( $post ) {
			$val = get_post_meta( $post->ID, '_post_expiry_date', true );
			echo '<label style="display:block;margin-bottom:4px;">Noindex after:</label>';
			echo '<input type="date" name="post_expiry_date" value="' . esc_attr( $val ) . '" style="width:100%">';
			echo '<p style="margin-top:6px;color:#666;font-size:11px;">Leave blank to never auto-noindex.</p>';
		},
		'post',
		'side'
	);
} );

add_action( 'save_post', function( $post_id ) {
	if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) return;
	if ( ! current_user_can( 'edit_post', $post_id ) ) return;
	if ( isset( $_POST['post_expiry_date'] ) ) {
		update_post_meta(
			$post_id,
			'_post_expiry_date',
			sanitize_text_field( $_POST['post_expiry_date'] )
		);
	}
} );
```

Set `$expiry_categories` to your category IDs before using it. Hover a category in Posts, Categories and read `tag_ID` from the URL. The placeholder `0` is not a real category, so until you change it the snippet should not noindex anything. Check one expiring post and one normal post before you rely on it.

Needs Yoast SEO (free or premium) and WordPress 5.3 or later, because `wp_timezone()` arrived in 5.3.

## Why the timezone matters

The date comes from an HTML date input, so it is just `2026-04-07` with no timezone. If you compare that against UTC, a post set to expire on the 7th goes dark at 07:00 or 08:00 local time in Asia, or late on the 6th in the Americas. Using `wp_timezone()` reads the timezone from Settings, General, and the post expires at **midnight on the site's clock**.

The snippet builds both `DateTime` objects with that same timezone, so the comparison is consistent.

## Checking it works

You cannot trust the editor for this. Yoast's robots dropdown in wp-admin shows the stored setting ("Yes, default for Posts") and does not reflect what the `wpseo_robots` filter returns. Look at the front-end `<meta name="robots">` tag instead, or use WP-CLI.

Confirm the date saved:

```bash
wp post meta get 123 _post_expiry_date
```

Expect a `YYYY-MM-DD` string. Confirm the post's category is one of yours:

```bash
wp post term list 123 category --fields=term_id,name
```

Then test the whole decision. `is_singular()` is always false under WP-CLI, so the filter cannot run there. Replay its logic instead:

```bash
wp eval '
$post_id = 123;
$cats = [5734, 5739];
$in_cat = has_term($cats, "category", $post_id);
$expiry = get_post_meta($post_id, "_post_expiry_date", true);
$tz = wp_timezone();
$now = new DateTime("now", $tz);
$exp = new DateTime($expiry . " 00:00:00", $tz);
echo "In category: " . ($in_cat ? "yes" : "no") . "\n";
echo "Expiry date: $expiry\n";
echo "Expired: " . ($exp < $now ? "yes" : "no") . "\n";
'
```

For `noindex` to fire you want `yes`, a valid date and `yes`.

One more trap: on a staging site with sitewide noindex on, the tag says `noindex` for every page, so the front-end tells you nothing. Use the `wp eval` check there.

## Limits

- It only handles posts. Change `is_singular( 'post' )` and the meta box's post type for a custom post type.
- It relies on Yoast. Without it, the `wpseo_robots` filter never runs. Other SEO plugins have their own robots filters.
- A noindexed page can take weeks to drop out of results. If a page must disappear now, remove it in Search Console as well.

---

*Handling expiring content another way, for example redirecting or unpublishing? Find me on Mastodon at [@jfrumau@mastodon.social](https://mastodon.social/@jfrumau).*
