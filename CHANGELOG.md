# Changelog

All notable changes to the WP Villain blog will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- Header nav no longer overflows/gets cut off on mobile — `.site-nav` now collapses behind a `<details>`-based hamburger menu below 600px, with no JavaScript required. The nav links are defined once via a Liquid `capture` in `_includes/header.html` and rendered into both the always-visible desktop list and the mobile dropdown, so there's a single source of truth

## [1.0.0] - 2026-08-14

### Added
- **Villain theme**: a new local Jekyll theme replacing `jekyll-theme-console`, owned entirely in this repo (`_layouts`, `_includes`, `assets/main.css`) instead of a remote gem
- "Case file" design language: every post is a field report — a colored side tab encodes its category and a status stamp (`Patched`, `Hardened`, `Resolved`, `Documented`, `Shipped`) encodes its outcome, driven by new `case_category` / `case_status` front matter on each post
- New editorial type system: Newsreader (serif display), IBM Plex Sans (body), IBM Plex Mono (metadata/code) — all self-hosted as `.woff2` under `assets/fonts/`, no external font/CDN requests
- New layouts: `_layouts/default.html`, `home.html`, `post.html`, `page.html`
- New includes: `_includes/head.html`, `header.html`, `footer.html`, and a reusable `_includes/case-card.html` post-card partial
- Redesigned homepage hero with a stat strip (sites shipped, years in production, load target, hosting stack) and a rotating "Case Open" stamp
- Syntax highlighting for code blocks (Rouge) restyled to match the new palette
- `_config.yml`: `markdown: kramdown` and `highlighter: rouge` set explicitly now that the theme gem no longer sets defaults

### Changed
- The three tag archive pages (WordPress, WooCommerce, Speed Optimization) and the homepage now render posts through the shared `case-card.html` partial for a consistent look
- Homepage intro copy trimmed to a single paragraph, now rendered directly inside the hero instead of a separate `<ul>` post list
- `404.html` restyled to match the new theme and rewritten as HTML (was invalid Markdown link syntax in a `.html` file, so it never actually rendered as a link)
- Content Security Policy tightened to `style-src 'self'` / `font-src 'self'` now that fonts are self-hosted (previously allowed `fonts.googleapis.com` / `fonts.gstatic.com`)
- `Gemfile` / `Gemfile.lock`: removed the `jekyll-theme-console` dependency

### Fixed
- Four posts had a redundant `# Title` heading duplicating their front-matter `title`, which was leaking into Jekyll's auto-generated `excerpt` (showing the title as the card summary) and double-printing the title on the post page itself

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
[1.0.0]: https://github.com/wpvillain/wpvillain.github.io/compare/v0.7.0...v1.0.0
[0.7.0]: https://github.com/wpvillain/wpvillain.github.io/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/wpvillain/wpvillain.github.io/pull/6
[0.5.0]: https://github.com/wpvillain/wpvillain.github.io/pull/5
[0.4.0]: https://github.com/wpvillain/wpvillain.github.io/pull/4
[0.3.0]: https://github.com/wpvillain/wpvillain.github.io/pull/3
[0.2.0]: https://github.com/wpvillain/wpvillain.github.io/pull/2
[0.1.0]: https://github.com/wpvillain/wpvillain.github.io/pull/1
[0.0.1]: https://github.com/wpvillain/wpvillain.github.io/commit/ebf4801
