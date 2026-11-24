---
layout: post
title: "Similar Products on Single Product Page"
description: "For a particular client we wanted to offer very similar products as thumbnail links under products. The linked products would be similar products. The..."
date: 2020-01-31 03:39:06 +0000
categories: woocommerce
tags: [page, product, products, similar, single, woocommerce, wordpress]
---

<p>For a particular client we  wanted to offer very similar products as thumbnail links under products. The linked products would be similar products. They would however have to be separate products offering differences in color, fabric and pricing. They would also have a sample on offer each of them. </p>

<h2 class="wp-block-heading">Variable Product?</h2>

<p>Variable products do offer all the freedom in size, color and other attributes and even allow you to use variable prices. But as we really wanted to have independent products and even sell a sample per product this was not ideal at all. That is why a <a href="https://docs.woocommerce.com/document/variable-product/">variable product</a> was not a good choice. </p>

<h2 class="wp-block-heading">Cross-Sell Linked Products</h2>

<p>A cross sell was appealing as it would allow this linking and allow related products to stay intact as option below each product with cross-sell or linked product thumbnails. Here a little summary of the options for product linking in general.</p>

<p><a href="https://docs.woocommerce.com/document/related-products-up-sells-and-cross-sells/#section-2">Cross Sells</a> are products that you would like to sell besides other products. They are often complementary items but they don't have to be. In our case they would be more like related products. <a href="https://docs.woocommerce.com/document/related-products-up-sells-and-cross-sells/#section-3">Related products</a> are products related by tag or categorie. An option we wanted to keep open. So we did not want to use them as thumbnails below products of choice. <a href="https://docs.woocommerce.com/document/related-products-up-sells-and-cross-sells/#section-1">Up-sells</a> are products that tend to be pricier you try to get people interested in while looking at another product.  Products you recommend so to speak. We will not be using them for now.</p>

<h2 class="wp-block-heading">Cross-Sell Display</h2>

<p>So as you can see cross-sells seemed to be the best choice. Now we wanted them to load on each product page where need be with ease and if a cross-sell would be removed or changed the thumbnail and link would have to be removed or updated. Normally cross-sells are loaded when you are at the cart page. And we wanted them on the single product page.</p>

<h2 class="wp-block-heading">WooCommerce Cross Sell Products Shortcode</h2>

<p>The Plugin <a href="https://wordpress.org/plugins/woocommerce-cross-sell-products-display/">WooCommerce Cross Sell Products</a> Display allows the display of cross-sell products using a shortcode on single product pages or pretty much anywhere you would need them shown. It basically uses this code to get the cross-sell ids:</p>

```
$crosssells = get_post_meta( $product_id, '_crosssell_ids', true);
```

<p>There is even a carousel options for upsells, cross-sells and related products. Example shortcode here below:</p>

```
[wcsp_cross_sell orderby=”rand” order=”ASC” product_num=”5″ display_columns=”3″ title=”Some title..” product_id=”Product ID” class=”class-1 class-2 class-3″]
```

<h2 class="wp-block-heading">Advanced Field Integration</h2>

<p>If you need to load the shortcode in an advanced custom field as you want to easily load cross-sell on product pages  <a href="https://support.advancedcustomfields.com/forums/topic/shortcodes-in-text-field/">you can do so as well</a>. You can simply use the following code in your template:</p>

```
do_shortcode( get_field('FIELDNAME') );
```

<p>or allow it more broadly for certain field types inside functions.php using</p>

```php
add_filter('acf/format_value/type=textarea', 'do_shortcode');
```

<p>You can of course pick another field type as well of course.</p>
