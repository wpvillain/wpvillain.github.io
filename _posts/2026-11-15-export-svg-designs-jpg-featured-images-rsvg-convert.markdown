---
layout: post
title: "Export SVG Designs to JPG Featured Images With rsvg-convert"
date: 2026-11-15 10:00:00 +0700
categories: wordpress images devops
tags: [wordpress, svg, jpg, featured-images, open-graph, librsvg, imagemagick, bash]
case_category: devops
case_status: documented
---

I design featured images, LinkedIn banners and Mastodon headers as SVG. The SVG stays the source: text is editable, colours are tokens, and it scales to any size. But WordPress featured images, `og:image` share cards and most social platforms want a raster file, and JPG is the one every one of them accepts (see [why the featured image stays a JPG for og:image](/wordpress-webp-featured-images-og-image-original-jpg/)). So every SVG needs a JPG export next to it, and it needs re-exporting whenever the design changes.

## The command

Two tools: librsvg's `rsvg-convert` renders the SVG, ImageMagick encodes the JPG.

```bash
brew install librsvg imagemagick

rsvg-convert banner.svg -o /tmp/banner.png
magick /tmp/banner.png -background white -flatten -quality 90 banner.jpg
```

Sizing goes on `rsvg-convert`. Because the source is vector, rendering larger loses nothing:

```bash
rsvg-convert -z 2 banner.svg -o /tmp/banner.png            # twice the viewBox size
rsvg-convert -w 1920 banner.svg -o /tmp/banner.png         # 1920 wide, height follows the aspect ratio
rsvg-convert -w 1200 -h 630 card.svg -o /tmp/card.png      # exactly 1200x630, an og:image card
```

Give both `-w` and `-h` only when the SVG's viewBox already has that aspect ratio. Otherwise pick one and let the other follow.

## The things that go wrong

**Transparent areas turn black.** JPG has no transparency. An SVG without a full-size background rectangle leaves the PNG transparent around the edges, and encoding that straight to JPG fills those pixels with black. `-background white -flatten` puts the image on white first:

```bash
magick banner.png -quality 90 banner.jpg                             # transparent corners come out black
magick banner.png -background white -flatten -quality 90 banner.jpg  # white
```

**A missing font fails silently.** If the SVG names a font that is not installed, `rsvg-convert` picks a fallback and exits 0. The export looks almost right and the heading is in the wrong typeface. Check before exporting:

```bash
fc-list | grep -i montserrat
brew install --cask font-montserrat   # if it is missing
```

**ImageMagick's own SVG reader is not the same renderer.** `magick banner.svg banner.jpg` works for simple files, but it renders through a different path than a browser, and on a file with a missing font it stopped with `unable to read font`. librsvg is what GNOME uses to draw SVG icons; gradients, text and clip paths come out the way a browser draws them. Render with `rsvg-convert`, encode with `magick`.

**Exports drift from the source.** The JPG is a throwaway build product. Keep it out of git (`*.jpg` next to the SVGs in `.gitignore`), and re-export after every edit instead of editing the JPG.

## Scripting it

The script below exports every SVG in a folder, or the files you name, as a JPG next to its source. It takes the same sizing options, checks for both tools, and prints each result's size so a wrong one stands out. It runs on macOS's own `/bin/bash` 3.2.

```bash
#!/usr/bin/env bash
#
# svg-to-jpg.sh -- Export design SVGs to JPG (raster previews).
#
# Renders each .svg next to its source as a .jpg at the SVG's native size,
# flattened on white at quality 90. Uses librsvg (rsvg-convert) for accurate
# font + gradient rendering, then ImageMagick to encode JPG.
#
# Usage:
#   svg-to-jpg.sh                            # default: designs/linkedin
#   svg-to-jpg.sh designs/business-cards     # one or more dirs/files
#   svg-to-jpg.sh path/to/banner.svg
#   svg-to-jpg.sh -w 1920 -h 1080 designs/mastodon   # force size
#   svg-to-jpg.sh -s 2 designs/featured-images       # 2x scale
#
# Options:
#   -w N   output width in px  (aspect ratio preserved if only one of -w/-h set)
#   -h N   output height in px
#   -s N   scale multiplier (e.g. 2 = twice native size); ignored if -w/-h given
#   -q N   JPEG quality 1-100 (default 90)

set -euo pipefail

QUALITY=90
WIDTH=""
HEIGHT=""
SCALE=""

while getopts ":w:h:s:q:" opt; do
  case "$opt" in
    w) WIDTH="$OPTARG" ;;
    h) HEIGHT="$OPTARG" ;;
    s) SCALE="$OPTARG" ;;
    q) QUALITY="$OPTARG" ;;
    :) echo "ERROR: -$OPTARG requires a value" >&2; exit 1 ;;
    \?) echo "ERROR: unknown option -$OPTARG" >&2; exit 1 ;;
  esac
done
shift $((OPTIND - 1))

# Build the rsvg-convert sizing flags from the options above.
RSVG_SIZE=()
if [ -n "$WIDTH" ]; then RSVG_SIZE+=(-w "$WIDTH"); fi
if [ -n "$HEIGHT" ]; then RSVG_SIZE+=(-h "$HEIGHT"); fi
if [ ${#RSVG_SIZE[@]} -eq 0 ] && [ -n "$SCALE" ]; then RSVG_SIZE+=(-z "$SCALE"); fi

TMP_PNG="$(mktemp -t svg2jpg).png"
trap 'rm -f "$TMP_PNG"' EXIT

for bin in rsvg-convert magick; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "ERROR: '$bin' not found. Install with:" >&2
    echo "  brew install librsvg imagemagick" >&2
    exit 1
  fi
done

# Default to designs/linkedin under the current directory.
TARGETS=("$@")
if [ ${#TARGETS[@]} -eq 0 ]; then
  if [ -d "designs/linkedin" ]; then
    TARGETS=("designs/linkedin")
  else
    echo "ERROR: no target given and ./designs/linkedin does not exist." >&2
    echo "Usage: $(basename "$0") [-w N] [-h N] [-s N] [-q N] <dir-or-file>..." >&2
    exit 1
  fi
fi

svgs=()
for t in "${TARGETS[@]}"; do
  if [ -d "$t" ]; then
    while IFS= read -r f; do svgs+=("$f"); done < <(find "$t" -type f -name '*.svg' | sort)
  elif [ -f "$t" ] && [[ "$t" == *.svg ]]; then
    svgs+=("$t")
  else
    echo "WARN: skipping '$t' (not a directory or .svg file)" >&2
  fi
done

if [ ${#svgs[@]} -eq 0 ]; then
  echo "No .svg files found." >&2
  exit 1
fi

count=0
for svg in "${svgs[@]}"; do
  jpg="${svg%.svg}.jpg"
  # ${arr[@]+...}: bash 3.2 treats an empty array as unset under set -u.
  rsvg-convert ${RSVG_SIZE[@]+"${RSVG_SIZE[@]}"} "$svg" -o "$TMP_PNG"
  magick "$TMP_PNG" -background white -flatten -quality "$QUALITY" "$jpg"
  printf "  %-58s -> %s\n" "$svg" "$(magick identify -format '%wx%h %b' "$jpg")"
  count=$((count + 1))
done

echo "Done. Exported $count JPG(s)."
```

```text
$ svg-to-jpg.sh -w 1200 -h 630 designs/featured-images
  designs/featured-images/og-card.svg                        -> 1200x630 36888B
Done. Exported 1 JPG(s).
```

Upload the JPG as the post's featured image, and the share card and the theme both get a file they can use, while the SVG stays the thing you edit.
