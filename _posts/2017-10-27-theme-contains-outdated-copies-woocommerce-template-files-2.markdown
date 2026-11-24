---
layout: post
title: "Your theme contains outdated copies of some WooCommerce template files"
description: "Often when you upgrade WooCommerce you get the error Your theme contains outdated copies of some WooCommerce template files. Ianua in this case. How t..."
date: 2017-10-27 11:17:34 +0000
categories: woocommerce
tags: [contains, copies, outdated, theme, woocommerce, wordpress]
---

Often when you upgrade WooCommerce you get the error <em>Your theme contains outdated copies of some WooCommerce template files</em>. Ianua in this case. How to resolve this issue? Well. let's work things out shall we?
<h2>Check System Status Page</h2>
The error message Y<em>our theme contains outdated copies of some WooCommerce template files</em> will also indicate you should check the system status page where they will show you what pages are outdated. Here the full error message:
<pre>Your theme (Ianua) contains outdated copies of some WooCommerce template files. These files may need updating to ensure they are compatible with the current version of WooCommerce. You can see which files are affected from the system status page. If in doubt, check with the author of the theme.</pre>
NB They also refer to&nbsp;<a href="https://docs.woocommerce.com/document/template-structure/" target="_blank" rel="noopener noreferrer">https://docs.woocommerce.com/document/template-structure/</a> to learn more about the WooCommerce template structure
<h2>Outdated Templates</h2>
At the bottom of the system status page they will show you what templates are outdated.

<img class="alignnone size-large wp-image-7387" src="https://wooaid.com/wp-content/uploads/2017/10/Outdated-Templates-1024x233.png" alt="Outdated Templates" width="980" height="223">

If you are the author of the theme it will be up to you to update the files in question. If you bought the theme from another developer you should ask them for an update and then overwrite the theme according to their instructions.
<h2>Updating Theme Caveats</h2>
Now remember, just because a template got an update it does not mean the theme won't work anymore. Two, if you would update a theme you bought by yourself you may lose the layout that was set up using it so do this only if you know what you are doing. Better to contact the theme builder before you make any changes yourself!
<h2>When to Update</h2>
If we check ianua/archive-product.php for example we will see that we added the product archive page as we wanted a specific display:

https://gist.github.com/jasperf/69d0a74a6132e8b4bd2ae794a7f0bac4

A custom <a href="https://codex.wordpress.org/Class_Reference/WP_Query" target="_blank" rel="noopener noreferrer">WP_Query</a> was created to load the products. This so additional html could be added for all the page elements with ease. This page was on the list of pages needing an update according to WooCommerce. It stated
<pre>ianua/archive-product.php version - is out of date. The core version is 2.0.0,</pre>
This page won't be updated at this moment though. That is because of the custom code for one. It also is not using any WooCommerce functionality that no longer works. If the latter would have been the case we would have had to update the outdated code.

So only update if the files that need updating do not have any custom code, which will be rare if the file in question is part of the theme. Two, if there is custom, only update the functionality that is outdated or even causing (fatal) errors.
<h2>Removing the Warning</h2>
If you do want the warning not to be mentioned anymore, add the correct block with the file version number. In this case the block would be:
<div>
<pre>/**
* The Template for displaying product archives, including the main shop page which is a post type archive
*
* This template can be overridden by copying it to yourtheme/woocommerce/archive-product.php.
*
* HOWEVER, on occasion WooCommerce will need to update template files and you
* (the theme developer) will need to copy the new files to your theme to
* maintain compatibility. We try to do this as little as possible, but it does
* happen. When this occurs the version of the template file will be bumped and
* the readme will list any important changes.
*
* @see &nbsp;&nbsp;&nbsp;&nbsp; https://docs.woocommerce.com/document/template-structure/
* @author &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;WooThemes
* @package &nbsp;&nbsp;&nbsp;&nbsp;WooCommerce/Templates
* @version 2.0.0
*/</pre>
As you can see the version was 2.0.0 at the time of the writing of this blog post. Of course other files have other version numbers.

</div>
