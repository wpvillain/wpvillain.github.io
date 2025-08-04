# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a Jekyll-based GitHub Pages site for WP Villain. The site uses the standard Jekyll structure with the Minima theme and is automatically deployed via GitHub Actions.

## Development Commands

### Local Development
- `bundle install` - Install Ruby dependencies
- `bundle exec jekyll serve` - Start local development server
- `bundle update` - Update gem dependencies

### Building
The site is automatically built and deployed via GitHub Actions on pushes to the main branch. The workflow is defined in `.github/workflows/jekyll-gh-pages.yml`.

## Architecture

### Site Structure
- `_config.yml` - Jekyll configuration and site metadata
- `_posts/` - Blog posts in Markdown format with YAML front matter
- `index.markdown` - Homepage content
- `about.markdown` - About page content
- `404.html` - Custom 404 error page

### Theme and Plugins
- Uses the `minima` theme (~> 2.5)
- Includes `jekyll-feed` plugin for RSS/Atom feeds
- Jekyll version pinned to ~> 4.4.1

### Content Guidelines
- Blog posts should be placed in `_posts/` with filename format: `YYYY-MM-DD-title.markdown`
- Posts require YAML front matter with title, date, and categories/tags
- Site metadata (title, description, social links) is configured in `_config.yml`

### Deployment
- Automatic deployment to GitHub Pages on main branch pushes
- Uses GitHub's standard Jekyll build action
- Deployment permissions configured in workflow file