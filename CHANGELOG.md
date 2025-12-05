# Changelog

All notable changes to the WP Villain blog will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.7.0] - 2025-12-05

### Added
- Footer menu for better mobile navigation
- About page now appears in footer instead of header
- Changelog file to track all notable changes to the project

### Changed
- Simplified header navigation by removing dynamic page loop
- Updated navigation configuration to use `footer_pages` for footer menu
- Set `header_pages` to empty array to prevent unwanted pages in header

### Fixed
- Resolved issue with tag pages appearing in header navigation
- Improved mobile layout by reducing header menu items

## [0.6.0] - 2025-11-25

### Added
- Three dedicated tag landing pages for improved content discoverability:
  - WordPress tutorials tag page
  - WooCommerce tutorials tag page
  - Speed Optimization tutorials tag page
- Tag navigation links in site header

### Changed
- Enhanced site navigation with prominent tag page links
- Updated `CLAUDE.md` with detailed tag system guidance
- Improved content organization strategy with tag-focused architecture

### Documentation
- Updated documentation to reflect new tag navigation system
- Added guidelines for consistent content categorization

## [0.5.0] - 2025-11-25

### Added
- New comprehensive guide: "WooCommerce vs Shopify 2025: Which Platform is Right for Your Business"
  - Platform architecture comparison
  - Cost analysis and ROI considerations
  - Scalability and performance insights
  - Specific use case recommendations
- New guide: "WordPress Speed Optimization Guide 2025"
  - Hosting recommendations
  - Caching strategies
  - Image optimization techniques
  - Core Web Vitals optimization
- Mastodon social profile integration

### Changed
- Enhanced existing posts with SEO meta descriptions
- Added Open Graph tags for better social media sharing
- Updated about page and homepage with Mastodon links

### Improved
- Search engine visibility for technical content
- Social media sharing capabilities
- Click-through rates from search results

## [0.4.0] - 2025-11-24

### Added
- Introductory content block on homepage
- Enhanced landing page with contextual messaging for visitors

### Changed
- Updated `index.markdown` with new intro section
- Improved initial user experience

## [0.3.0] - 2025-11-24

### Changed
- Completely redesigned About page with comprehensive professional biography
- Replaced generic placeholder content with WordPress development expertise showcase
- Added specific technical focus areas:
  - Gutenberg block development
  - Roots Sage theme framework
  - Advanced Custom Fields (ACF) workflows
- Established site purpose and value proposition

## [0.2.0] - 2025-11-24

### Added
- Home navigation link in site header

### Changed
- Updated Jekyll configuration for improved navigation structure
- Modified `index.markdown` for better navigation integration
- Updated GitHub Actions workflow configuration

### Improved
- User navigation with clear path to homepage from any page

## [0.1.0] - 2025-11-24

### Added
- Console theme implementation for developer-focused aesthetic
- `vendor/` directory to `.gitignore`

### Changed
- Replaced Minima theme with jekyll-theme-console
- Updated `Gemfile` and `Gemfile.lock` with new theme dependencies
- Updated Jekyll configuration to use Console theme with dark style

### Removed
- Previous Minima theme configuration

## [0.0.1] - 2025-11-24

### Added
- Initial Jekyll site setup
- GitHub Pages deployment via GitHub Actions
- Basic site structure and configuration
- First blog posts:
  - "Building a Custom WordPress Walker for Multilingual Mobile Navigation"
  - "Debugging PHP-FPM Memory Exhaustion in WordPress/WooCommerce on Trellis"
  - "The WordPress Query Filter Infinite Recursion Trap"
- Custom domain configuration (wpvilla.in)
- Jekyll SEO plugin
- Jekyll Feed plugin
- Custom 404 page

[Unreleased]: https://github.com/wpvillain/wpvillain.github.io/compare/main...HEAD
[0.7.0]: https://github.com/wpvillain/wpvillain.github.io/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/wpvillain/wpvillain.github.io/pull/6
[0.5.0]: https://github.com/wpvillain/wpvillain.github.io/pull/5
[0.4.0]: https://github.com/wpvillain/wpvillain.github.io/pull/4
[0.3.0]: https://github.com/wpvillain/wpvillain.github.io/pull/3
[0.2.0]: https://github.com/wpvillain/wpvillain.github.io/pull/2
[0.1.0]: https://github.com/wpvillain/wpvillain.github.io/pull/1
[0.0.1]: https://github.com/wpvillain/wpvillain.github.io/commit/ebf4801
