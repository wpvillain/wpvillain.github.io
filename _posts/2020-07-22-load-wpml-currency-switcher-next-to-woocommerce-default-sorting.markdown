---
layout: post
title: "Load WPML currency switcher next to WooCommerce Default Sorting"
description: "How to add something just before the default sorting of WooCommerce on product category pages. Well, that is not that easy you will find out. General..."
date: 2020-07-22 07:06:50 +0000
categories: wordpress
tags: [currency, load, next, switcher, wordpress, wpml]
---

<p>How to add something just before the default sorting of WooCommerce on product category pages. Well, that is not that easy you will find out.</p>

<h2>General Filter Hook</h2>

<p>There is a general method you can tweak:</p>

```
woocommerce_default_catalog_orderby
```

<p>But it is just for filtering the WooCommerce default sorting options and possible add new options.</p>

<p>See <a href="http://hookr.io/filters/woocommerce_default_catalog_orderby/">http://hookr.io/filters/woocommerce_default_catalog_orderby/</a> </p>

<h2>Adding Filters</h2>

<p>So as Cloudways tells we can use:</p>

```php
function cw_add_postmeta_ordering_args( $args_sort_cw ) {
$cw_orderby_value = isset( $_GET['orderby'] ) ? wc_clean( $_GET['orderby'] ) :
    apply_filters( 'woocommerce_default_catalog_orderby', get_option( 'woocommerce_default_catalog_orderby' ) );
switch( $cw_orderby_value ) {
    case 'points_awarded':
        $args_sort_cw['orderby'] = 'meta_value_num';
        $args_sort_cw['order'] = 'desc';
        $args_sort_cw['meta_key'] = 'points';
        break;
   case 'location':
        $args_sort_cw['orderby'] = 'meta_value';
        $args_sort_cw['order'] = 'asc';
        $args_sort_cw['meta_key'] = 'location';
        break;
```

<p>to sort by location and points . See <a href="https://www.cloudways.com/blog/woocommerce-product-sort-and-display/">https://www.cloudways.com/blog/woocommerce-product-sort-and-display/</a></p>

<h2>Before or after Action Hooks?</h2>

<p>But there seem to be no before or after default sorting hooks we can use. There are many for the product page as well as the category page. But one to add something just before sorting does not seem to exist. There is a filter, but there are no actions.</p>

<h2>New Action Hook</h2>

<p>Now, we could create our own <code>do_action</code> so we can hook to it. But we would then also need to add the hook to our template at the location where the ordering is being done.</p>

```php
function imwz_before_default_sorting () {
do_action ('imwz_before_default_sorting');
}
```

<p>Then we would need to hook into that using</p>

```php
add_action('imwz_before_default_sorting', 'prod_cat_before_sorting')
```

<p>And then we would need the actual method</p>

```php
function prod_cat_before_sorting () {
do_action('wcml_currency_switcher', array('format' => '%name% (%symbol%)'));
}
```

<h2>Child Templates</h2>

<p>This you would however need to add to your product category or product page template. This cannot be added with ease in let's say Oxygen Builder, Elementor on in basic WordPress using a plugin. It would need to be added to a child theme's WooCommerce category and product templates. This is just a copy of the base template files you can find in the plugin and then use in your child theme.</p>
