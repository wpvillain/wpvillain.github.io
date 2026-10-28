---
layout: post
title: "WordPress WebP Featured Images Without Breaking og:image: Convert Resized Copies, Keep the Original JPG"
date: 2026-10-28 17:00:00 +0700
categories: wordpress performance wp-cli
tags: [wordpress, webp, performance, wp-cli, the-seo-framework, open-graph, block-themes]
case_category: performance
case_status: shipped
---

My blog posts had featured images, but the theme never showed them. I had uploaded them as JPG because the social share card (`og:image`) is built from that file, and Facebook has been unreliable with WebP share images. Showing a 65 KB JPG at the top of every post was not what I wanted either, so the page needed WebP and the share card needed to stay a JPG.

WordPress can do this with one filter. It has one catch, which is what this post is about.

## One filter for the page image

Since WordPress 6.1 you can choose the output format of resized images:

```php
add_filter( 'image_editor_output_format', function ( $formats ) {
	$formats['image/jpeg'] = 'image/webp';
	return $formats;
} );

add_filter( 'wp_editor_set_quality', function ( $quality, $mime_type ) {
	return $mime_type === 'image/webp' ? 80 : $quality;
}, 10, 2 );
```

Every JPG you upload from now on gets its sizes (`-300x158`, `-768x403`, `-1024x538`) written as `.webp`. The upload itself is kept as `original_image` in the attachment metadata. On a 1200x630 graphic, the 1024px size dropped from 65 KB as JPG to 15 KB as WebP.

In the template, print the image with `get_the_post_thumbnail()` and let WordPress build the `srcset`. The image is the largest thing above the fold, so load it eagerly with high priority and not lazily:

```php
echo get_the_post_thumbnail( null, 'large', array(
	'sizes'         => '(min-width: 1280px) 880px, 100vw',
	'loading'       => 'eager',
	'fetchpriority' => 'high',
) );
```

I also cropped it to 2:1 with `aspect-ratio` and `object-fit: cover`. A full 1200x630 image at an 880px content width is about 460px tall, which is a lot of scrolling before the first paragraph.

## The catch: the full-size file is converted too

I opened a post with a JPG featured image and checked the share tags:

```bash
curl -s https://example.test/my-post/ | grep -oE '(og|twitter):image" content="[^"]*"'
```

Both pointed at a `.webp`. The filter does not only change the resized copies. After the image is regenerated, the main `file` in the attachment metadata is the WebP, and the original JPG is only listed as `original_image`. The SEO Framework reads `file`, so it published the WebP as `og:image`, which was exactly what I wanted to avoid.

The fix is to point the social image back at the original. The SEO Framework has filters for both the generated and the custom (per-post override) image details:

```php
$social_image_original = function ( $details ) {
	foreach ( $details as &$detail ) {
		if ( empty( $detail['id'] ) ) {
			continue;
		}
		$original = wp_get_original_image_url( (int) $detail['id'] );
		if ( $original && preg_match( '/\.(jpe?g|png)$/i', $original ) ) {
			$detail['url'] = $original;
		}
	}
	return $details;
};
add_filter( 'the_seo_framework_generated_image_details', $social_image_original );
add_filter( 'the_seo_framework_custom_image_details', $social_image_original );
```

Images that were uploaded as WebP have no `original_image`, so they are left alone. Run the `curl` again and `og:image` and `twitter:image` are the JPG, while the `<img>` in the page is the WebP.

## Existing posts need a full regenerate, not `--only-missing`

The filter only runs when WordPress writes image files. Posts uploaded before it still have JPG sizes. My first plan was `wp media regenerate --only-missing`, but that only creates sizes that do not exist yet, and the JPG sizes do exist, so nothing gets converted. You need a regenerate without that flag.

I did not want to regenerate the whole library (product images included), so I took only the featured images of published posts:

```bash
wp eval 'global $wpdb; echo implode( " ", $wpdb->get_col(
  "SELECT DISTINCT m.meta_value FROM {$wpdb->postmeta} m
   JOIN {$wpdb->posts} p ON p.ID = m.post_id
   WHERE m.meta_key = \"_thumbnail_id\"
   AND p.post_type = \"post\" AND p.post_status = \"publish\"" ) );'

wp media regenerate <those IDs> --skip-delete --yes
```

`--skip-delete` matters. Without it WordPress removes the old JPG sizes, and any post that uses one of them inline in its content shows a broken image. With it, the old files stay on disk and only the featured image path changes. The cost is some orphaned JPG files, which can be cleaned up later. I took a database backup first, because regenerate rewrites attachment metadata.

## Checks after the run

Use a post that was regenerated and one that was not:

```bash
# page image is WebP, share image is JPG
curl -s https://example.com/my-post/ | grep -oE '<img[^>]*wp-post-image[^>]*src="[^"]*"|og:image" content="[^"]*"'

# the files exist and are the size you expect
curl -sI https://example.com/app/uploads/2026/10/my-post-featured-1024x538.webp | grep -iE "^HTTP|content-type|content-length"
```

On my production site the three posts I checked served `image/webp` at 15 to 21 KB, and the share tags still pointed at the JPG. One of them went from a 73 KB JPG to a 17 KB WebP.

The filter above only maps `image/jpeg`. About half of my older featured images are PNG, and those stayed PNG: one tutorial post now shows a 327 KB PNG at the top. If your library has many, add `$formats['image/png'] = 'image/webp';` and regenerate those IDs as well, then check `og:image` again (the original-URL filter already accepts PNG).

Also keep in mind that the format filter applies to every JPG upload, so WooCommerce product images switch to WebP as well. If you only want it for featured images, wrap the filter in a check for the attachment's use, or regenerate only the IDs you want and leave the filter off for the rest.

I wrote up the image-size side of this in a separate post on [serving the right-sized WebP to mobile](https://imagewize.com/wordpress-image-missing-srcset-pagespeed/), where a single 105 KB image was the only PageSpeed finding left.
