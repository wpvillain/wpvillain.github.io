---
layout: post
title: "SEO Framework Bulk NoIndex"
description: "Sometimes you realize you need to prune your blogs. This as you are trying to focus on a specific field or fields . You sometimes need to get rid of p..."
date: 2026-04-05 06:52:45 +0000
categories: seo
tags: [bulk, framework, noindex, seo, wordpress]
---

<p>Sometimes you realize you need to prune your blogs. This as you are trying to focus on a specific field or fields . You sometimes need to get rid of posts that are not related to your core work. With the SEO Framework you can go through your posts and do this manually post by post. That works if there are not too many posts. </p>



<h2 class="wp-block-heading">WP CLI </h2>



<p>But this can be a lot of work. Easier is to do this with WordPress CLI . You of course first need to backup your site and then use the cli tool You also may have to double check once work is done because most commands if you search for a specific keyword in the post and noindex you get some false positives. </p>



<h2 class="wp-block-heading">WP Eval</h2>



<p>The script we use is the following here below. At the end of the day it runs a backup when you do a live run and then users <code>wp eval</code> to run a database query on the server to updated posts to noindex based on keyword you use. Here first two examples of the eval usage if you would not use my script. Keep in mind we add <code>--path</code> only because we work with Trellis &amp; Bedrock.</p>



<p>First the example to do a dry run to see what we got:</p>




```bash
# Dry run — count posts                                                                                                      
  wp eval '       
  $posts = get_posts(array(                                                                                                    
    "s" => "laravel",
    "post_type" => "post",
    "post_status" => "publish",
    "numberposts" => -1,                                                                                                       
    "fields" => "ids"
  ));                                                                                                                          
  echo count($posts) . " posts\n";
  ' --path=web/wp
```




<p>and for a live run</p>




```bash
# Live — noindex them
  wp eval '                                                                                                                    
  $posts = get_posts(array(
    "s" => "laravel",
    "post_type" => "post",
    "post_status" => "publish",                                                                                                
    "numberposts" => -1,
    "fields" => "ids"                                                                                                          
  ));             
  foreach ($posts as $id) {
    update_post_meta($id, "_genesis_noindex", 1);
  }                                                                                                                            
  echo count($posts) . " noindexed\n";
  ' --path=web/wp
```




<h2 class="wp-block-heading">Automation with Commands</h2>



<p>And here is the actual script. It does the same as the <code>wp eval</code> examples above but in an easier way. When I wanted to <code>noindex</code> Vue posts I just ran:</p>




```
./tools/scripts/bulk-noindex-category.sh --run --search="vue"   
==========================================
Bulk Noindex - imagewize.com
Date: Sun Apr  5 11:36:24 WIB 2026
Mode: LIVE RUN
Method: keyword search for "vue"
==========================================

[1/3] Backing up database...
Success: Exported to '/tmp/backup-before-noindex-20260405_113624.sql'.
✓ Backup saved to /tmp/backup-before-noindex-20260405_113624.sql on production server

[2/3] Processing posts...

--- Keyword search: "vue" ---
  Noindexed: 31 published posts

[3/3] Summary
==========================================
Done. Total posts noindexed: 31

Next steps:
  1. Verify in wp-admin: check SEO column on affected posts
  2. Submit updated sitemap to Google Search Console
  3. DB backup is at: /tmp/backup-before-noindex-20260405_113624.sql (on production server)
==========================================
```




<h2 class="wp-block-heading">Full Script</h2>



<p>Here the full script below. Check it. Adjust it to your liking. Use it at your own risk. Do backup before usage just in case. Works really well for me. Hope it helps others.</p>




```bash
#!/bin/bash
#
# Bulk Noindex Posts by Category or Keyword Search for imagewize.com
# Purpose: Set _genesis_noindex=1 (The SEO Framework) on all posts in given
#          categories or matching a keyword search term.
# This removes non-WordPress content from Google's index to improve SEO relevance.
#
# Usage:
#   ./bulk-noindex-category.sh                        # dry run, default categories
#   ./bulk-noindex-category.sh --run                  # apply to default categories (DB backup included)
#   ./bulk-noindex-category.sh --run --cat="Laravel"  # apply to single category
#   ./bulk-noindex-category.sh --search="laravel"     # dry run, keyword search
#   ./bulk-noindex-category.sh --run --search="laravel" # apply by keyword search
#
# Requires: SSH access to web@imagewize.com, WP-CLI on production

set -e

# Configuration
WP_PATH="web/wp"
WP_DIR="/srv/www/imagewize.com/current"
SSH_USER="web@imagewize.com"
BACKUP_DIR="/tmp"
DATE=$(date +%Y%m%d_%H%M%S)

# Default categories when no --cat or --search is given
DEFAULT_CATEGORIES=("Laravel" "DevOps")

# Parse arguments
DRY_RUN=true
CUSTOM_CAT=""
SEARCH_TERM=""

for arg in "$@"; do
  case $arg in
    --run)
      DRY_RUN=false
      ;;
    --cat=*)
      CUSTOM_CAT="${arg#*=}"
      ;;
    --search=*)
      SEARCH_TERM="${arg#*=}"
      ;;
  esac
done

echo "=========================================="
echo "Bulk Noindex - imagewize.com"
echo "Date: $(date)"
echo "Mode: $([ "$DRY_RUN" = true ] && echo 'DRY RUN (no changes)' || echo 'LIVE RUN')"
if [ -n "$SEARCH_TERM" ]; then
  echo "Method: keyword search for \"${SEARCH_TERM}\""
elif [ -n "$CUSTOM_CAT" ]; then
  echo "Method: category \"${CUSTOM_CAT}\""
else
  echo "Method: default categories (${DEFAULT_CATEGORIES[*]})"
fi
echo "=========================================="
echo ""

# Step 1: Backup database (only when applying changes)
if [ "$DRY_RUN" = false ]; then
  BACKUP_FILE="${BACKUP_DIR}/backup-before-noindex-${DATE}.sql"
  echo "[1/3] Backing up database..."
  ssh "$SSH_USER" "cd ${WP_DIR} && wp db export ${BACKUP_FILE} --path=${WP_PATH}"
  echo "✓ Backup saved to ${BACKUP_FILE} on production server"
  echo ""
else
  echo "[1/3] Skipping backup (dry run)"
  echo ""
fi

echo "[2/3] Processing posts..."
TOTAL_AFFECTED=0

# --- Keyword search mode ---
if [ -n "$SEARCH_TERM" ]; then
  echo ""
  echo "--- Keyword search: \"${SEARCH_TERM}\" ---"

  if [ "$DRY_RUN" = true ]; then
    COUNT=$(ssh "$SSH_USER" "cd ${WP_DIR} && wp eval '
\$posts = get_posts(array(
  \"s\" => \"${SEARCH_TERM}\",
  \"post_type\" => \"post\",
  \"post_status\" => \"publish\",
  \"numberposts\" => -1,
  \"fields\" => \"ids\"
));
echo count(\$posts);
' --path=${WP_PATH}")
    echo "  Would noindex: ${COUNT} published posts"
    TOTAL_AFFECTED=$((TOTAL_AFFECTED + COUNT))
  else
    RESULT=$(ssh "$SSH_USER" "cd ${WP_DIR} && wp eval '
\$posts = get_posts(array(
  \"s\" => \"${SEARCH_TERM}\",
  \"post_type\" => \"post\",
  \"post_status\" => \"publish\",
  \"numberposts\" => -1,
  \"fields\" => \"ids\"
));
foreach (\$posts as \$id) {
  update_post_meta(\$id, \"_genesis_noindex\", 1);
}
echo count(\$posts);
' --path=${WP_PATH}")
    echo "  Noindexed: ${RESULT} published posts"
    TOTAL_AFFECTED=$((TOTAL_AFFECTED + RESULT))
  fi

# --- Category mode ---
else
  if [ -n "$CUSTOM_CAT" ]; then
    CATEGORIES=("$CUSTOM_CAT")
  else
    CATEGORIES=("${DEFAULT_CATEGORIES[@]}")
  fi

  for CAT_NAME in "${CATEGORIES[@]}"; do
    echo ""
    echo "--- Category: ${CAT_NAME} ---"

    if [ "$DRY_RUN" = true ]; then
      COUNT=$(ssh "$SSH_USER" "cd ${WP_DIR} && wp eval '
\$cat = get_term_by(\"name\", \"${CAT_NAME}\", \"category\");
if (! \$cat) { echo 0; exit; }
\$posts = get_posts(array(
  \"cat\" => \$cat->term_id,
  \"post_type\" => \"post\",
  \"post_status\" => \"publish\",
  \"numberposts\" => -1,
  \"fields\" => \"ids\"
));
echo count(\$posts);
' --path=${WP_PATH}")
      echo "  Would noindex: ${COUNT} published posts"
      TOTAL_AFFECTED=$((TOTAL_AFFECTED + COUNT))
    else
      RESULT=$(ssh "$SSH_USER" "cd ${WP_DIR} && wp eval '
\$cat = get_term_by(\"name\", \"${CAT_NAME}\", \"category\");
if (! \$cat) { echo \"Category not found: ${CAT_NAME}\"; exit; }
\$posts = get_posts(array(
  \"cat\" => \$cat->term_id,
  \"post_type\" => \"post\",
  \"post_status\" => \"publish\",
  \"numberposts\" => -1,
  \"fields\" => \"ids\"
));
foreach (\$posts as \$id) {
  update_post_meta(\$id, \"_genesis_noindex\", 1);
}
echo count(\$posts);
' --path=${WP_PATH}")
      echo "  Noindexed: ${RESULT} published posts"
      TOTAL_AFFECTED=$((TOTAL_AFFECTED + RESULT))
    fi
  done
fi

echo ""

# Step 3: Summary
echo "[3/3] Summary"
echo "=========================================="
if [ "$DRY_RUN" = true ]; then
  echo "DRY RUN complete."
  echo "Posts that would be noindexed: ${TOTAL_AFFECTED}"
  echo ""
  echo "To apply changes, run:"
  echo "  ./bulk-noindex-category.sh --run                    # default categories"
  echo "  ./bulk-noindex-category.sh --run --search=\"laravel\" # by keyword"
  echo "  ./bulk-noindex-category.sh --run --cat=\"Laravel\"    # by category"
else
  echo "Done. Total posts noindexed: ${TOTAL_AFFECTED}"
  echo ""
  echo "Next steps:"
  echo "  1. Verify in wp-admin: check SEO column on affected posts"
  echo "  2. Submit updated sitemap to Google Search Console"
  echo "  3. DB backup is at: ${BACKUP_FILE} (on production server)"
fi
echo "=========================================="
```

