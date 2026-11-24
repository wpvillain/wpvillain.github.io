---
layout: post
title: "Block SVG & Block Binding"
description: "Lately I bumped into an issue with our Nynaeve Theme based on Sage 11. Blocks that had svg icon images broke on rebuild . They would load as invalid b..."
date: 2026-04-04 08:42:49 +0000
categories: wordpress
tags: [binding, block, wordpress]
---

<p>Lately I bumped into an issue with our<a href="https://imagewize.com/themes/nynaeve-theme/" data-type="page" data-id="12269"> Nynaeve Theme</a> based on Sage 11. Blocks that had svg icon images broke on rebuild . They would load as invalid blocks code on each built. Seems that Vite would load them in using a different url hash than the one WordPress had stored them in the database. So on some searching I realized WordPress had already come up with a solution for that.  They call it <a href="https://developer.wordpress.org/block-editor/reference-guides/block-api/block-bindings/">block bindings</a>. </p>



<blockquote class="wp-block-quote">
<p>The Block Bindings API lets you “bind” dynamic data to the block’s attributes, which are then reflected in the final HTML markup that is output to the browser on the front end.</p>
</blockquote>



<p>So basically instead of just letting WordPress store the icon or image you add in the database as a url hash which gets rebuild on every <code>npm run build</code> you store a binding reference, which will always stay truthful to its final destination. </p>



<h2 class="wp-block-heading">Block Binding</h2>



<p>The action WordPress has for that is called <code>register_block_bindings_source</code> or Register Block Bindings Source.</p>



<p>The action takes a name as string <code>imagewize/theme-icon</code> and an array of data including <code>label</code>, <code>get_value_callback</code>. The callback in turn takes </p>



<ul class="wp-block-list">
<li><code>source_args</code>, </li>



<li><code>block_instance</code> and </li>



<li><code>attribute_name</code>. </li>
</ul>



<p>Label is the label of your choosing and preferably one that can be translated. The source arguments get an instance of the post in question , and then attribute name. </p>



<h2 class="wp-block-heading">Attribute Name</h2>



<p>The attribute name for image blocks are <code>id</code>, <code>url</code>, <code>title</code>, <code>alt</code>, and <code>caption</code>. We will be filtering for urls and if attribute is not an url or empty we return right away.</p>



<p>The icon path for the url uses <code>ltrim</code> which </p>



<blockquote class="wp-block-quote">
<p>Strip whitespace (or other characters) from the beginning of a string</p>
</blockquote>



<p>and it uses the $source_args to get the path. That variable is an array containing  source arguments. Details of Attribute name and other values we got are fed to <code>Vite::asset</code> (<em>Illuminate\Support\Facades\Vite::asset</em>). </p>



<pre class="wp-block-code"><code>/**
 * Register block bindings source for theme SVG icons.
 *
 * Instead of storing hashed Vite asset URLs in post_content (which break on every
 * rebuild), editor.jsx templates store a binding reference with the icon path.
 * This callback resolves the current Vite asset URL at render time, so the
 * frontend always serves the correct file regardless of content hash changes.
 *
 * Usage in block template:
 *   metadata: { bindings: { url: { source: 'imagewize/theme-icon', args: { path: 'icon-link.svg' } } } }
 *
 * Paths are relative to resources/images/icons/ (e.g. 'icon-link.svg', 'elayne/icon-fse.svg').
 */
add_action('init', function () {
    register_block_bindings_source('imagewize/theme-icon', &#91;
        'label' => __('Theme Icon', 'imagewize'),
        'get_value_callback' => function (array $source_args, \WP_Block $block_instance, string $attribute_name): ?string {
            if ($attribute_name !== 'url' || empty($source_args&#91;'path'])) {
                return null;
            }

            $icon_path = ltrim(str_replace('..', '', $source_args&#91;'path']), '/');

            try {
                return Vite::asset('resources/images/icons/'.$icon_path);
            } catch (\Exception $e) {
                return null;
            }
        },
    ]);
});</code></pre>



<h2 class="wp-block-heading">Editor Addition  Block Binding Source</h2>



<p> But then we are not done yet. Then we need to pass current Vite-resolved icon links to the block editor as <code>window.imagewizeIcons</code> to be used there. That we do with the action <code>enqueue_block_editor_assets</code> . We are dealing with icon assets here.</p>



<blockquote class="wp-block-quote">
<p>In the function call you supply, simply use <code>wp_enqueue_script</code> and <code>wp_enqueue_style</code> to add your functionality to the block editor.</p>
</blockquote>



<p>And this method is combined with <code>wp_add_inline_script</code> to add the Icons as JSON data.</p>



<pre class="wp-block-code"><code>/**
 * Pass current Vite-resolved icon URLs to the block editor as window.imagewizeIcons.
 *
 * editor.jsx templates use these as the initial url attribute on core/image blocks
 * so icons display correctly in the editor. The imagewize/theme-icon binding handles
 * correct resolution on the frontend — these localized values are editor-only fallbacks.
 *
 * Add an entry here whenever a new block imports SVG icons via core/image.
 */
add_action('enqueue_block_editor_assets', function () {
    // Keys are the icon paths (matching binding args.path) → current Vite asset URL.
    // Add an entry here whenever a new block uses imagewize/theme-icon bindings.
    $icon_paths = &#91;
        // icon-grid block
        'icon-link.svg',
        'icon-copy.svg',
        'icon-x-circle.svg',
        'icon-list.svg',
        'icon-bar-chart.svg',
        'icon-code.svg',
        'icon-map.svg',
        'icon-chat.svg',
        // trust-bar block
        'icon-shield.svg',
        'icon-users.svg',
        'icon-clock.svg',
        // service-hero block
        'icon-search.svg',
        // feature-cards block
        'elayne/icon-fse.svg',
        'elayne/icon-performance.svg',
        'elayne/icon-patterns.svg',
        'elayne/icon-plugin.svg',
        'elayne/icon-responsive.svg',
        'elayne/icon-accessible.svg',
    ];

    $icons = &#91;];
    foreach ($icon_paths as $path) {
        try {
            $icons&#91;$path] = Vite::asset('resources/images/icons/'.$path);
        } catch (\Exception $e) {
            $icons&#91;$path] = '';
        }
    }

    wp_add_inline_script(
        'wp-blocks',
        'window.imagewizeIcons = '.wp_json_encode($icons).';',
        'before'
    );
});</code></pre>



<p></p>
