---
layout: post
title: "Add Packaging Fee to Checkout"
description: "To add a packaging fee for your WooCommerce products on checkout you have many options. You could work with custom fields, additional pricing calculat..."
date: 2020-06-14 06:45:06 +0000
categories: woocommerce
tags: [checkout, packaging, woocommerce, wordpress]
---

<p>To add a packaging fee for your WooCommerce products on checkout you have many options. You could work with custom fields, additional pricing calculations, but in this post we will use hard coded actions instead.</p>



<h2 class="wp-block-heading">WooCommerce Cart Calculate Fee with Add Fee</h2>



<p>can use the following code</p>



<pre class="wp-block-code"><code><code>add_action('woocommerce_cart_calculate_fees', function() { </code><code>if (is_admin() &amp;&amp; !defined('DOING_AJAX')) { return; } </code><code>WC()->cart->add_fee(__('Packaging Fee' 'txtdomain'), 5); </code><code>});</code></code></pre>



<p>This is a fixed price and not based on the price or cart total nor connected to shipping. Just a once off fee. Other options including this one can be found at <a href="https://awhitepixel.com/blog/woocommerce-checkout-add-custom-fees/">White Pixel</a>.</p>



<p>On the action and cart / recurring cart fees you can also check the <a href="https://docs.woocommerce.com/document/subscriptions/develop/recurring-cart-fees/">WooCommerce documentation</a>:</p>



<p><em>Unlike cart items, cart fees are non-persistent, this means third-party plugins which add fees need to be constantly hooked into the cart calculations, adding their fees each time the cart totals are calculated.</em></p>



<p><em>To do that WooCommerce provides the <code>woocommerce_cart_calculate_fees</code> hook, which third parties can use to add their fees.</em></p>



<h2 class="wp-block-heading">Standard Cart / Checkout Surcharge incl Country Filter</h2>



<p>Also see <a href="https://docs.woocommerce.com/document/add-a-surcharge-to-cart-and-checkout-uses-fees-api/">cart and checkout surcharge document</a> where a similar snippet is used among others:</p>



<pre class="wp-block-code"><code>/**
Add a standard $ value surcharge to all transactions in cart / checkout
*/
add_action( 'woocommerce_cart_calculate_fees','wc_add_surcharge' );
function wc_add_surcharge() {
global $woocommerce;
if ( is_admin() &amp;&amp; ! defined( 'DOING_AJAX' ) )
return;
$county = array('US');
// change the $fee to set the surcharge to a value to suit
$fee = 1.00;
if ( in_array( WC()-&gt;customer-&gt;get_shipping_country(), $county ) ) :
$woocommerce-&gt;cart-&gt;add_fee( 'Surcharge', $fee, true, 'standard' );
endif;
}</code></pre>



<p>Do realize they also filter by country in this snippet. They do not just add a general surcharge fee for all locations.</p>



<p>WooCommerce also shared a percentage charge per transaction:</p>



<pre class="wp-block-code"><code>/**
Add a 1% surcharge to your cart / checkout
change the $percentage to set the surcharge to a value to suit
*/
add_action( 'woocommerce_cart_calculate_fees','woocommerce_custom_surcharge' );
function woocommerce_custom_surcharge() {
global $woocommerce;
if ( is_admin() &amp;&amp; ! defined( 'DOING_AJAX' ) )
return;
$percentage = 0.01;
$surcharge = ( $woocommerce-&gt;cart-&gt;cart_contents_total + $woocommerce-&gt;cart-&gt;shipping_total ) * $percentage;
$woocommerce-&gt;cart-&gt;add_fee( 'Surcharge', $surcharge, true, '' );
}</code></pre>



<p>which is related to one of the snippets provided by White Pixel.</p>



<h2 class="wp-block-heading">Gotchas</h2>



<p>You do have to remember that this option does not allow you do adjust the fee in the backend and so it is not a flexible fee. You could work with a custom field as well perhaps, but that will not be added to this post just yet.</p>
