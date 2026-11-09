---
layout: post
title: "AI Steering Me or I AI? How Claude Code Quietly Switched My Block Themes From Blocks to PHP Patterns"
date: 2026-11-09 10:00:00 +0700
categories: ai block-themes
tags: [ai, ai-agents, claude-code, block-themes, block-patterns, gutenberg, aludra, aviendha]
case_category: ai
case_status: documented
---

<!-- Moved from imagewize.com production draft post 14400 (Nov 9, 2026). Still a draft: last section unfinished. -->

A thought came to me earlier this morning: has Claude Code been slowly changing my development strategy? The way I set up themes, the way I build plugins? You might say that of course AI pushes people, makes them more effective at coding, debugging and building apps. That is true, but it is not what I mean. I mean that Claude, as an agent running the Claude LLM, is changing the way I pick my theme building strategy.

## PHP Patterns Pain

Initially I built [Aludra](https://wordpress.org/plugins/aludra/), yes also with help of Claude, as a blocks page builder. I wanted to use native blocks and patterns and not Elementor, but also because I disliked PHP based patterns. They are hard to read with their JSON data and odd hybrid HTML. And the HTML and JSON have to match, otherwise you get invalid blocks. I had many issues with that in the beginning. Stuff like this below shows what I mean by JSON wrapped around HTML:

```php
<!-- wp:group {"align":"full","style":{"spacing":{"margin":{"top":"0","bottom":"0"},"padding":{"top":"var:preset|spacing|medium","bottom":"var:preset|spacing|x-large"}}},"layout":{"type":"constrained"}} -->
<div class="wp-block-group alignfull" style="margin-top:0;margin-bottom:0;padding-top:var(--wp--preset--spacing--medium);padding-bottom:var(--wp--preset--spacing--x-large)"><!-- wp:columns {"align":"wide","verticalAlignment":"center","style":{"spacing":{"blockGap":{"left":"var:preset|spacing|x-large"}}}} -->
...
<figure class="wp-block-image size-full is-style-stapel"><img src="<?php echo esc_url( get_theme_file_uri( 'assets/images/tuin-portret.webp' ) ); ?>" alt="alt tage removed" style="aspect-ratio:0.89;object-fit:cover"/><figcaption class="wp-element-caption"><strong>Oude tegels, nieuwe rand</strong>Hergebruikt als plantenbak.</figcaption></figure>
<!-- /wp:image --></div>
<!-- /wp:column -->
```

## React Blocks vs PHP Patterns

When you make patterns in a code editor as PHP files they become painful because of this, and because of the invalid block issues that crop up. I did create the [WP Pattern Sentinel](https://www.npmjs.com/package/@imwz/wp-pattern-sentinel) package to check and validate them, but it is still a lot of work. I found that out building the [Elayne theme](https://wordpress.org/themes/elayne/). I learned this the hard way. Now with Sentinel I have far fewer issues, but it is still the AI that is happiest, not me as a developer.

I like patterns built with React and the WordPress packages. Built that way they are called blocks. Though any pattern stored in WordPress is in the end a block, even the PHP created ones. The point is that code built this way is clearer and easier to read. Nicer to humans.

## Claude Chose PHP Based Patterns

But then I had to work on a new theme based off [Aviendha](https://github.com/imagewize/aviendha) and I suddenly realized Claude had started building patterns. It skipped the Aludra page builder altogether. For pages, and later on, because the damage was done, also for sections of pages.

Now, for an AI, PHP page and section patterns are quite easy to build. Though I had to build Sentinel to correct the mistakes Claude and Mistral Vibe made creating them. I needed them validated; without it, building with them was way slower. I think Claude picked patterns because the blocks Aludra had were not quite a match, and perhaps because patterns are faster. Blocks are not really needed unless you do fancier stuff requiring custom fields, variations, more intricate CSS effects, things like that.

But when it comes to maintenance, patterns are a pain for me as a developer. JSON wrapped around HTML does not read well. A block like Aludra's comparison table reads way better. See [its `edit.js`](https://github.com/imagewize/aludra/blob/main/blocks/comparison-table/src/edit.js), for example. The top of the file:

```js
import {
	useBlockProps,
	InnerBlocks,
	RichText,
	InspectorControls,
} from '@wordpress/block-editor';
import { PanelBody, ToggleControl } from '@wordpress/components';
import { __ } from '@wordpress/i18n';

import './editor.scss';

const CELL = ( heading, body ) => [
	'aludra/comparison-cell',
	{ heading, body },
];

const ROW = ( label, parameterKey, category, cells ) => [
	'aludra/comparison-row',
	{ label, parameterKey, category },
	cells,
];

const TEMPLATE = [
	ROW( 'Architecture', 'system.engine', 'Environments & Delivery', [
		CELL(
			'Git-Native, Zero Server',
			'Push a branch, get a URL. Build, release and health check run on our edge — nothing to patch.'
		),
...
```

That is very easy to read and understand. And with blocks you can do anything you want: not just the simpler things patterns do, but also the more sophisticated ones.

## Plan Going Forward

So what I will do is start pushing back against Claude and other AI agents again, and tell them to use Aludra, and so blocks, wherever possible, and to upgrade existing blocks by adding variations if need be, like we did in the past. We can still use page patterns and load in blocks
