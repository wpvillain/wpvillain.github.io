---
layout: post
title: "Letting Coding Agents Build WordPress Pages with the Abilities API"
seo_title: "Coding Agents and the WordPress Abilities API: Aludra Tested"
description: "How five Abilities API abilities in Aludra let Claude Code, OpenCode with Kimi K2.7 and Mistral Vibe build valid block pages, and how abilities, REST and MCP differ."
date: 2026-11-13 16:00:00 +0700
categories: ai block-themes
tags: [ai, ai-agents, claude-code, opencode, kimi, mistral, vibe, abilities-api, mcp, rest-api, gutenberg, block-patterns, aludra, aviendha]
case_category: ai
case_status: documented
---

Ask a coding agent to build a WordPress page and it will happily write block markup for you. It looks fine on the front end. Then someone opens the page in the editor and every custom block says "This block contains unexpected or invalid content". The agent wrote the HTML from memory, and it doesn't match what the block's `save()` function produces.

I kept hitting this with [Aludra](https://github.com/imagewize/aludra), my block library for the Elayne and Aviendha themes, including in the [bakery demo]({% post_url 2026-11-13-mistral-vibe-large-4-bakery-demo-block-theme-lessons %}). The fix was not a better prompt. It was to stop asking agents to write markup at all and give them a small set of **abilities** instead: pick patterns, supply copy, and let the server assemble the page. This post covers what I built, how three different agents got on with it, and where the Abilities API sits next to the REST API and MCP.

## Five abilities

Aludra registers five abilities with the WordPress Abilities API, which has been in core since WordPress 6.9:

| Ability | Method | What it does |
| --- | --- | --- |
| `aludra/list-patterns` | GET | Pattern slugs, titles, kinds, categories and descriptions |
| `aludra/get-pattern` | GET | One pattern's markup, plus the exact texts and links you may replace, its style variations and whether it takes a colour scheme |
| `aludra/list-blocks` | GET | Aludra block types with attributes, parent rules and styles |
| `aludra/compose-page` | POST | Creates or updates a page from an ordered list of patterns |
| `aludra/check-page` | GET | Structural check of a page's blocks |

The important one is `compose-page`. It takes registered patterns, which have already passed my pattern validator in the real block editor, and changes only four things:

- **Whole text runs.** A `find` must equal one of the strings `get-pattern` lists; substrings don't match. Each run is replaced in the HTML and in block comment attributes alike, so an FAQ question stored in an attribute can never drift from the one in the markup.
- **Link targets.**
- **The section's style variation**, from the styles the pattern offers.
- **The section's colour scheme** (`tint`, `invert`, `brand`), where the pattern supports one.

Replacements go through `sanitize_text_field()` and `esc_url_raw()`, so an agent can't inject HTML, classes or layout. New pages are drafts unless the agent asks otherwise, and publishing needs the `publish_pages` capability. The agent supplies intent and copy; WordPress supplies the markup.

## Giving the agent a login

Abilities run with the permissions of the user behind an application password. I give the agent a user of its own rather than my admin account. An Editor can do everything `compose-page` needs (`edit_pages`, and `publish_pages` if you ever let it publish) without touching plugins, themes or settings:

```bash
# A dedicated user for the agent
wp user create agent agent@example.com --role=editor

# An application password for it; --porcelain prints only the password
wp user application-password create agent coding-agent --porcelain
```

Give the agent `agent:<password>` as its basic-auth credentials. On a multisite, add `--url=` with the subsite to both commands, and on Trellis run them in the VM with `trellis vm shell --workdir /srv/www/<site>/current -- wp … --path=web/wp`; the `--path` is needed because Bedrock keeps WordPress core in `web/wp`. You can also create the password in wp-admin under Users → Profile → Application Passwords.

WordPress only offers application passwords over HTTPS, or when `WP_ENVIRONMENT_TYPE` is `local`. On a plain-HTTP dev site, set that first.

When you're done, revoke the password, or delete the user entirely:

```bash
wp user application-password list agent --fields=uuid,name
wp user application-password delete agent <uuid>

# or remove the user and hand its pages to user 1
wp user delete agent --reassign=1
```

## What a call looks like

The agent first reads a pattern to learn which strings it may replace:

```bash
export WP=https://example.com/wp-json/wp-abilities/v1/abilities
export AUTH='user:abcd efgh ijkl mnop qrst uvwx'

curl -su "$AUTH" "$WP/aludra/get-pattern/run?input%5Bslug%5D=aludra/section-cta-banner"
```

Then it composes the page:

```bash
curl -su "$AUTH" -X POST "$WP/aludra/compose-page/run" \
  -H 'Content-Type: application/json' -d '{
  "input": {
    "title": "About us",
    "sections": [
      { "pattern": "aludra/section-about", "scheme": "tint",
        "texts": [ { "find": "Who we are", "replace": "About us" } ] },
      { "pattern": "aludra/section-cta-banner", "style": "light",
        "texts": [ { "find": "Get in Touch", "replace": "Contact Us" } ],
        "links": [ { "find": "#", "replace": "https://example.com/contact" } ] }
    ]
  }
}'
```

The response carries the `page_id`, an edit link and a `warnings` list naming any `find` that matched nothing. A final call to `check-page` confirms that every block is registered and sits under an allowed parent.

## Three agents, one result

I wanted to know whether this works for agents other than the one that helped write it, so I ran it with three of them against my local Trellis demo site (WordPress 7.1.4, on the Aviendha subsite). Each one posted its findings to the [pull request](https://github.com/imagewize/aludra/pull/82).

### Claude Code

Claude Code wrote the abilities with me and tested them hardest. Every pattern `compose-page` can use round-tripped byte-identically through `parse_blocks()` and `serialize_blocks()`. Two composed pages, with text, link and style changes and the tint, brand and invert schemes, passed the editor-based pattern validator, which opens the page in the real block editor and diffs what goes in against what comes out. It then ran every ability over HTTP with an application password and confirmed that anonymous calls get a `401`.

### OpenCode with Kimi K2.7 Code

OpenCode, running Moonshot's Kimi K2.7 Code, synced the plugin to the demo site, created its own temporary application password with WP-CLI and called all five abilities with `curl`. It built a two-section draft page (the about section on the tint scheme, the CTA banner in the light style, with text and link replacements), got `ok: true` from `check-page`, checked the byte-identical round trip, ran the lint, coding-standards and unit-test suites, and cleaned up the test page and password afterwards.

### Mistral Vibe

Mistral Vibe did the same on its own and went a step further on verification. It fetched the page back through `/wp/v2/pages` to confirm that the new copy and link were there, that the `is-aludra-scheme-tint` and `is-style-light` classes were applied, and that none of the original strings remained. `compose-page` returned no warnings, and it confirmed afterwards that the test page and application password were gone.

### The test loop on Trellis

All three agents followed the same loop against a local [Trellis](https://roots.io/trellis/) VM running Bedrock. Here it is with my paths swapped for placeholders, so you can run it yourself. `example.com` is the Trellis site key and `example.test` its dev host; on a multisite, point `--url` at the subsite.

**1. Sync the plugin to the site.** Test the working copy, not a release. I use `rsync-package-to-site` from [wp-ops](https://github.com/imagewize/wp-ops), which copies the same files a release zip would contain:

```bash
export SITE_ROOT=~/code/example.com/site/web/app
wp-ops rsync-package-to-site plugin aludra ~/code/aludra
```

**2. Create a temporary application password** inside the VM:

```bash
cd ~/code/example.com/trellis
trellis vm shell --workdir /srv/www/example.com/current \
  -- wp user application-password create agent abilities-test --porcelain \
  --url=http://example.test/ --path=web/wp
```

**3. Call the abilities.** Check first that an anonymous call is refused:

```bash
export WP='http://example.test/wp-json/wp-abilities/v1/abilities'
export AUTH='agent:<app-password>'

curl -s -o /dev/null -w '%{http_code}\n' "$WP/aludra/list-patterns/run"   # 401
curl -su "$AUTH" "$WP/aludra/list-patterns/run?input%5Bkind%5D=section"
curl -su "$AUTH" "$WP/aludra/get-pattern/run?input%5Bslug%5D=aludra/section-about"
curl -su "$AUTH" "$WP/aludra/list-blocks/run"

curl -su "$AUTH" -X POST "$WP/aludra/compose-page/run" \
  -H 'Content-Type: application/json' --data @payload.json
# → {"page_id":942,"status":"draft","edit_url":"...","link":"...","warnings":[]}

curl -su "$AUTH" "$WP/aludra/check-page/run?input%5Bpage_id%5D=942"
# → {"page_id":942,"blocks":14,"ok":true,"issues":[]}
```

`payload.json` holds the same `{"input": {...}}` body as the `compose-page` example above. Keeping it in a file saves you from escaping apostrophes in the copy inside a shell string.

**4. Check the round trip.** If parsing and re-serializing the saved content gives back the same bytes, the markup survived intact:

```bash
trellis vm shell --workdir /srv/www/example.com/current -- wp eval '
$content = get_post( 942 )->post_content;
echo serialize_blocks( parse_blocks( $content ) ) === $content ? "Match: YES" : "Match: NO";
' --url=http://example.test/ --path=web/wp
```

This doesn't replace opening the page in the editor, but it catches markup that changes shape on its way through the block parser.

**5. Clean up** the test page and the password:

```bash
trellis vm shell --workdir /srv/www/example.com/current \
  -- wp post delete 942 --force --url=http://example.test/ --path=web/wp
trellis vm shell --workdir /srv/www/example.com/current \
  -- wp user application-password delete agent <uuid> --url=http://example.test/ --path=web/wp
```

One Trellis catch: `trellis vm shell` doesn't pass the command through a shell, so `&&`, pipes and redirects arrive as literal text and fail. Run each command separately, as above, or use `limactl shell <instance> -- bash -c '…'` when you need real chaining.

Three agents from three vendors, and none of them needed to know how an Aludra block serializes. That is the point: the interface is small enough, and the schemas explicit enough, that the choice of model matters much less.

Two catches came up along the way. One is the HTTPS-or-`local` rule for application passwords, covered above. The other is that `check-page` is a structural check only. It can't prove each block matches its `save()` output, because only the block editor can. Pages built purely with `compose-page` stay valid because the pattern markup is never rewritten, but hand-written markup isn't covered.

## Abilities, REST and MCP: what's the difference?

These three get mixed up, partly because an ability is usually *reached* over REST or MCP. They are different layers.

### The REST API: resources

The classic REST API exposes WordPress *data*: `/wp/v2/pages`, `/wp/v2/posts` and so on. You can create a page with `POST /wp/v2/pages`, but you have to send the finished `content` yourself. On a block theme that means the caller owns the block markup, and that is exactly the part agents get wrong.

### The Abilities API: actions

An ability is a named unit of work registered in PHP with `wp_register_ability()`. It has a JSON Schema for its input and output, a permission callback, an execute callback, and annotations saying whether it is read-only, destructive or idempotent. It describes *what the site can do*, not what data it holds. The logic, here the pattern assembly and the sanitizing, lives on the server, where a client can't skip it.

Core exposes abilities over REST under `/wp-abilities/v1`: list them, read one's schema, and run it at `/abilities/{name}/run`. Read-only abilities run with GET, others with POST. So "using Aludra's abilities over REST" means calling the Abilities API's own REST routes, not `/wp/v2`. That's how all three agents above worked: plain `curl`, an application password and no extra plugin.

### MCP: a protocol for agents

The Model Context Protocol is how AI clients discover and call tools. WordPress doesn't speak MCP in core. The official [MCP Adapter](https://github.com/WordPress/mcp-adapter) plugin translates registered abilities into MCP. Its default server offers three tools: discover abilities, get an ability's info, and execute one. It serves them over STDIO through WP-CLI (`wp mcp-adapter serve --user=admin`) for a local site, or over HTTP at `/wp-json/mcp/mcp-adapter-default-server`, authenticated with an application password and usually connected through the `@automattic/mcp-wordpress-remote` proxy.

Abilities are hidden from MCP by default. An ability opts in with `'meta' => array( 'public' => true )`, and can opt out of MCP alone with `'mcp' => array( 'public' => false )`. Aludra's abilities set `public`, so with the adapter installed they show up for MCP clients with no extra code. I haven't tested that route yet; all three runs above went over REST.

### Which one to use

- **An agent with a shell** (Claude Code, OpenCode, Mistral Vibe, Codex): call the abilities over REST. It needs nothing beyond core and an application password, and the agent can read the docs and use `curl`. This is what I tested.
- **A chat client without a shell**, or a team that wants the site's tools in the client's own tool list: install the MCP Adapter. Same abilities, same permission checks, different transport.
- **Plain data** (read a post, change a title): the REST API is still the right tool. Wrap something in an ability when the server should own the rules.

Put simply: **abilities define what an agent may do, and REST and MCP are two ways of calling them.** Write the rule once, in PHP, and every client gets the same guard rails.

## Try it

The abilities are merged into Aludra's `main` branch and ship in the next release (2.43.0 is the current one). They need WordPress 7.0 or later. The usage guide is in [`docs/agents.md`](https://github.com/imagewize/aludra/blob/main/docs/agents.md). Site owners who don't want them can switch them off with one filter:

```php
add_filter( 'aludra_abilities_enabled', '__return_false' );
```

If you build blocks yourself, the lesson carries over: don't hand agents your markup format and hope. Give them a small ability, described by a schema, that does the risky part on the server.
