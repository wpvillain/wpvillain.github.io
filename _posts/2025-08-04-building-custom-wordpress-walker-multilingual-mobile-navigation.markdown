---
layout: post
title: "Building a Custom WordPress Walker for Multilingual Mobile Navigation with Secondary Menus"
date: 2025-08-04 14:30:00 +0200
categories: wordpress navigation walker polylang multilingual
tags: [wordpress, php, walker, navigation, multilingual, polylang, mobile, acf]
---

# Building a Custom WordPress Walker for Multilingual Mobile Navigation with Secondary Menus

When building modern WordPress themes, mobile navigation often requires more sophisticated functionality than the standard WordPress menu system provides out of the box. Recently, I worked on a multilingual project for Allinq Digital that needed a two-level mobile navigation system with language detection, secondary menus, and custom navigation controls.

In this post, I'll walk you through how I created a custom WordPress Walker class that handles complex mobile navigation requirements while maintaining clean, maintainable code.

## The Challenge

The client needed a mobile navigation system with several specific requirements:

- **Two-level navigation structure** with main menu and expertise submenu
- **Multilingual support** for Dutch, English, and German using Polylang
- **Dynamic language detection** from URL structure
- **Custom navigation controls** (back button, close button)
- **Performance optimization** to minimize database queries
- **Fallback content** when WordPress menus aren't fully configured

## The Solution: Custom Walker Class

Instead of using multiple functions and queries, I created a single `Mobile_Nav_Walker` class that extends WordPress's `Walker_Nav_Menu` class. This approach consolidates all the logic into one optimized system.

### Basic Walker Structure

```php
class Mobile_Nav_Walker extends Walker_Nav_Menu {
    
    private $current_language = 'nl';
    private $expertise_parent_id = null;
    private $main_nav_html = '';
    private $categories = array();
    private $category_parents = array();
    
    public function __construct() {
        // Detect current language from URL
        $url = $_SERVER['REQUEST_URI'];
        if (preg_match('/\/en\//', $url)) {
            $this->current_language = 'en';
        } elseif (preg_match('/\/de\//', $url)) {
            $this->current_language = 'de';
        } else {
            $this->current_language = 'nl';
        }
    }
}
```

### Language Detection System

The walker automatically detects the current language by analyzing the URL structure. This works seamlessly with Polylang's URL-based language switching:

```php
private function get_language_button_text() {
    switch ($this->current_language) {
        case 'en':
            return array('back' => 'Back', 'close' => 'Close');
        case 'de':
            return array('back' => 'Zurück', 'close' => 'Schließen');
        default:
            return array('back' => 'Terug', 'close' => 'Sluiten');
    }
}
```

### Processing Menu Items

The `start_el` method processes each menu item and builds the navigation structure:

```php
public function start_el(&$output, $item, $depth = 0, $args = null, $id = 0) {
    
    // Process top-level navigation items
    if ($depth === 0 && $item->menu_item_parent == 0) {
        $classes = $item->classes ? $item->classes : array();
        $has_submenu = in_array('has-mega-menu', $classes) ? 'has-submenu' : '';
        $data_target = in_array('has-mega-menu', $classes) ? 'data-target="expertise"' : '';
        $arrow = $has_submenu ? '<span class="nav-arrow">›</span>' : '';
        
        // Store expertise parent ID for submenu processing
        if (in_array('has-mega-menu', $classes)) {
            $this->expertise_parent_id = $item->ID;
        }
        
        // Build main navigation HTML
        $this->main_nav_html .= '<a href="' . $item->url . '" class="nav-item ' . $has_submenu . '" ' . $data_target . '>';
        $this->main_nav_html .= $item->title . $arrow;
        $this->main_nav_html .= '</a>';
    }
    
    // Process expertise submenu items
    $classes = $item->classes ? $item->classes : array();
    
    // Direct children of Expertise (category headers)
    if ($item->menu_item_parent == $this->expertise_parent_id) {
        if (in_array('mega-menu-row-1', $classes)) {
            $this->categories[$item->title] = array();
            $this->current_category = $item->title;
            $this->category_parents[$item->ID] = $item->title;
        }
    }
    // Children of category headers (actual service items)
    elseif (isset($this->category_parents[$item->menu_item_parent])) {
        $parent_category = $this->category_parents[$item->menu_item_parent];
        $this->categories[$parent_category][] = $item;
    }
}
```

### Two-Level Navigation Structure

The walker generates a sophisticated two-level mobile navigation:

**Level 1: Main Menu**
- Logo
- Main navigation items
- Language-aware close button
- CTA button

**Level 2: Expertise Submenu**
- Language-aware back button
- Categorized service items
- Language-aware close button
- CTA button

```php
public function get_mobile_navigation_html() {
    $button_text = $this->get_language_button_text();
    
    $html = '<div class="mobile-nav-enhanced">';
    
    // Level 1: Main Menu
    $html .= '<div class="nav-level level-1">';
    $html .= '<div class="mobile-nav-header">';
    
    if (!empty(get_field('hs_logo', 'option'))) {
        $html .= '<img src="' . get_field('hs_logo', 'option') . '" alt="Allinq Digital" class="mobile-logo">';
    }
    
    $html .= '<button class="mobile-close-btn">' . $button_text['close'] . '</button>';
    $html .= '</div>';
    
    $html .= '<nav class="mobile-nav-menu">';
    $html .= $this->main_nav_html;
    $html .= '</nav>';
    
    $html .= '<div class="mobile-nav-cta">';
    $html .= $this->get_mobile_cta_button();
    $html .= '</div>';
    $html .= '</div>';
    
    // Level 2: Expertise Submenu
    $html .= $this->generate_expertise_submenu($button_text);
    
    $html .= '</div>';
    
    return $html;
}
```

### Multilingual CTA Buttons

The walker handles different CTA buttons for each language using Advanced Custom Fields:

```php
private function get_mobile_cta_button() {
    $header_btn = get_field('hs_button', 'option');
    $header_btn_en = get_field('hs_button_en', 'option');
    $header_btn_de = get_field('hs_button_de', 'option');
    
    $button_html = '';
    
    switch ($this->current_language) {
        case 'en':
            if (!empty($header_btn_en)) {
                $button_html = '<a href="' . $header_btn_en['url'] . '" class="mobile-cta-btn">';
                $button_html .= $header_btn_en['title'] . ' <span class="cta-arrow">→</span>';
                $button_html .= '</a>';
            }
            break;
        case 'de':
            if (!empty($header_btn_de)) {
                $button_html = '<a href="' . $header_btn_de['url'] . '" class="mobile-cta-btn">';
                $button_html .= $header_btn_de['title'] . ' <span class="cta-arrow">→</span>';
                $button_html .= '</a>';
            }
            break;
        default:
            if (!empty($header_btn)) {
                $button_html = '<a href="' . $header_btn['url'] . '" class="mobile-cta-btn">';
                $button_html .= $header_btn['title'] . ' <span class="cta-arrow">→</span>';
                $button_html .= '</a>';
            }
            break;
    }
    
    return $button_html;
}
```

### Intelligent Fallback System

One of the key features is the intelligent fallback system. If the WordPress menu isn't fully configured or lacks the expected structure, the walker provides language-appropriate fallback content:

```php
private function get_fallback_expertise_structure() {
    $html = '';
    
    switch ($this->current_language) {
        case 'en':
            $html .= '<div class="nav-category">';
            $html .= '<h3>Digitalisation</h3>';
            $html .= '<a href="#" class="nav-item">Scan to BIM <span class="nav-arrow">›</span></a>';
            $html .= '<a href="#" class="nav-item">Digital Channel <span class="nav-arrow">›</span></a>';
            $html .= '</div>';
            // ... more categories
            break;
            
        case 'de':
            $html .= '<div class="nav-category">';
            $html .= '<h3>Digitalisierung</h3>';
            $html .= '<a href="#" class="nav-item">Scan to BIM <span class="nav-arrow">›</span></a>';
            // ... more items
            break;
            
        default: // Dutch
            $html .= '<div class="nav-category">';
            $html .= '<h3>Digitaliseren</h3>';
            $html .= '<a href="#" class="nav-item">Scan to BIM <span class="nav-arrow">›</span></a>';
            // ... more items
            break;
    }
    
    return $html;
}
```

## Usage Implementation

To use the walker, I created a simple function that handles menu detection and fallbacks:

```php
function get_walker_mobile_navigation() {
    // Try to get menu by theme location first
    $locations = get_nav_menu_locations();
    $menu_id = isset($locations['main_menu']) ? $locations['main_menu'] : false;
    
    // If no menu assigned, try language-specific menu names
    if (!$menu_id) {
        $url = $_SERVER['REQUEST_URI'];
        
        if (preg_match('/\/en\//', $url)) {
            $menu_names = array('Main Menu (EN)', 'Main Menu EN');
        } elseif (preg_match('/\/de\//', $url)) {
            $menu_names = array('Main Menu (DE)', 'Main Menu DE');
        } else {
            $menu_names = array('Main Menu', 'Main Menu NL');
        }
        
        foreach ($menu_names as $menu_name) {
            $menu = wp_get_nav_menu_object($menu_name);
            if ($menu) {
                $menu_id = $menu->term_id;
                break;
            }
        }
    }
    
    // Generate navigation using walker
    if ($menu_id) {
        $walker = new Mobile_Nav_Walker();
        $menu_items = wp_get_nav_menu_items($menu_id);
        
        if ($menu_items) {
            foreach ($menu_items as $item) {
                $walker->start_el($output, $item, 0, null, 0);
            }
            return $walker->get_mobile_navigation_html();
        }
    }
    
    // Fallback if no menu found
    $walker = new Mobile_Nav_Walker();
    return $walker->get_mobile_navigation_html();
}
```

## Performance Benefits

This custom walker approach provides several performance advantages:

1. **Single Database Query**: Instead of multiple `wp_get_nav_menu_items()` calls, everything is processed in one query
2. **Efficient Processing**: Menu items are processed once and stored in class properties
3. **Lazy Generation**: HTML is only generated when requested
4. **Memory Efficient**: No redundant data structures or processing

## Template Integration

In your header template, simply call:

```php
echo get_walker_mobile_navigation();
```

The walker handles all the complexity behind the scenes, providing a clean API for your templates.

## CSS Considerations

The walker generates specific CSS classes for styling:

```css
.mobile-nav-enhanced {
    /* Main container */
}

.nav-level {
    /* Level containers (level-1, level-2) */
}

.mobile-nav-header {
    /* Header with logo/buttons */
}

.nav-item {
    /* Navigation links */
}

.nav-item.has-submenu {
    /* Items with submenus */
}

.nav-category {
    /* Category containers in submenu */
}

.mobile-cta-btn {
    /* CTA buttons */
}
```

## Key Takeaways

Building this custom walker taught me several important lessons:

1. **Plan for Flexibility**: Always consider multiple languages and fallback scenarios
2. **Optimize Early**: Single query approaches scale better than multiple function calls
3. **Encapsulate Logic**: Walker classes keep complex logic organized and reusable
4. **Test Edge Cases**: Empty menus, missing translations, and incomplete configurations
5. **Document Thoroughly**: Complex navigation systems need clear documentation

## Conclusion

Creating a custom WordPress Walker for mobile navigation might seem complex, but it provides incredible flexibility and performance benefits. This approach allowed me to create a sophisticated multilingual mobile navigation system that works seamlessly with Polylang while maintaining clean, maintainable code.

The walker pattern is particularly powerful for complex navigation requirements where the standard WordPress menu system falls short. By extending the built-in Walker class, you get all the benefits of WordPress's menu system while adding your own custom functionality.

Have you built custom walkers for your WordPress projects? I'd love to hear about your experiences and any additional techniques you've discovered!