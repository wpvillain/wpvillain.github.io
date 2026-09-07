---
layout: post
title: "Mistral Vibe Upwork MCP Server Setup with OAuth — Why the Docs Are Wrong and How to Fix It"
date: 2026-09-08 10:00:00 +0700
categories: vibe mcp upwork oauth ai
tags: [vibe, mcp, upwork, oauth, authentication, ai, cli, mistral]
case_category: ai
case_status: shipped
---

{% raw %}
If you've tried to connect Mistral Vibe to the Upwork MCP server and hit a wall, you've probably read the [official documentation on MCP servers](https://docs.mistral.ai/vibe/code/cli/mcp-servers) and come away confused. It states:

> Known limitation: the CLI does not yet support MCP servers that require OAuth authentication. Use the stdio or http transport with an API key or other static credential.

That statement is **out of date**. OAuth is fully implemented and working in Vibe today. The confusion stems from stale docs and a config gap that's easy to miss. Here's how to get the Upwork MCP server connected with OAuth in Vibe, what the docs get wrong, and why the fix is simpler than you think.

## The documentation gap: what the docs say vs. what the code does

The Mistral docs claim OAuth for MCP servers isn't supported. The actual code tells a different story. In the current Vibe repository (commit `6c79ef0`, Sep 4, 2026), OAuth support is complete and production-ready:

- [`vibe/core/auth/mcp_oauth.py`](https://github.com/mistralai/mistral-vibe/blob/6c79ef0e1ee484d7069bc38590d5917d3914cd48/vibe/core/auth/mcp_oauth.py) — full PKCE authorization-code flow, loopback callback server, OS-keyring token storage, refresh-aware handling, dynamic client registration (DCR) support
- [`vibe/cli/textual_ui/widgets/mcp_oauth_app.py`](https://github.com/mistralai/mistral-vibe/blob/6c79ef0e1ee484d7069bc38590d5917d3914cd48/vibe/cli/textual_ui/widgets/mcp_oauth_app.py) — the textual UI widget for the login flow

So why the disconnect? The docs are stale, and there's a subtle configuration detail that tripped up early attempts — including mine.

## The actual blocker: missing auth block in `.vibe/config.toml`

If your Upwork MCP server shows as **"enabled, no tools"** in Vibe, it's not because OAuth is unsupported. It's because your `[[mcp_servers]]` entry is missing the `[mcp_servers.auth]` block entirely. When that block is absent, Vibe defaults to `MCPStaticAuth` (empty, no token). The code that would auto-promote a server to OAuth on a 401 response — `_late_bound_oauth` in `vibe/app_server/_mcp_auth.py` — **explicitly excludes** config-owned `[[mcp_servers]]` entries. The comment in the source is clear: *"a static entry there is a decision."*

In practice, this means:

- Without `[mcp_servers.auth]`: Vibe treats the server as static-credential only. Attempting to authenticate via `/mcp` browser will fail with `MCP server 'upwork' is not configured for OAuth`.
- With `[mcp_servers.auth]` of `type = "oauth"`: Vibe starts the OAuth flow when you select the server in the `/mcp` browser and the server connects fully.

## The fix: three lines in `.vibe/config.toml`

Here's the working configuration I'm using in my SEO strategy project:

```toml
[[mcp_servers]]
name = "upwork"
transport = "http"
url = "https://mcp.upwork.com/mcp"

[mcp_servers.auth]
type = "oauth"
scopes = []
```

That's it. No `client_id`, no `client_metadata_url`. This relies on the Upwork MCP server supporting **Dynamic Client Registration** (RFC 7591) — and it does.

## How Dynamic Client Registration (DCR) works here

DCR is the key to why this config is so minimal. Instead of requiring you to pre-register an OAuth client with Upwork and paste static credentials into your config, the Upwork MCP server:

1. Accepts a DCR request from Vibe at OAuth flow start
2. Returns a temporary `client_id` and `client_secret` for that session
3. Uses those ephemeral credentials for the duration of the auth flow
4. Stores the resulting tokens in your OS keyring (via the `keyring` Python library)

The result: zero pre-registration, zero static secrets in your config. From the Vibe CLI, run `/mcp` to open the MCP server browser, select the **upwork** server, choose **Authenticate in browser**, complete the consent flow, and the server flips from `[http] no tools ● enabled` to `[http] 48 tools ● connected` with the full Upwork tool list:

- `upwork__find_jobs`
- `upwork__get_account`
- `upwork__boost_profile`
- And the rest of the Upwork MCP catalog

## Transport note: `http` vs. `streamable-http`

The docs mention transport types. In practice, both `transport = "http"` and `transport = "streamable-http"` route to the same code path in Vibe. From `registry.py:_discover_server`:

```python
case "http" | "streamable-http":
```

Both hit `_discover_http` → `streamable_http_client`. The distinction is a config-schema discriminator, not a functional difference. Use `http` unless you have a specific reason not to.

## Verification: it works

I applied the three-line auth block, then used the Vibe MCP browser to authenticate. From the Vibe CLI, run `/mcp` to open the MCP server browser, select the **upwork** server from the list, and choose **Authenticate in browser**. This launches your default browser to Upwork's OAuth consent screen. Complete the consent flow there, and Vibe automatically receives the OAuth tokens and connects the server. No manual client registration, no static keys, no workarounds. DCR against Upwork's MCP endpoint works with zero pre-registration.

As documented in [Mistral's MCP server docs under "Browse"](https://docs.mistral.ai/vibe/code/cli/mcp-servers#browse), the `/mcp` command opens an interactive MCP server browser that lists all configured servers and provides authentication options for each.

Separately, the Upwork MCP server also works headlessly via **Claude Code 2.1.251+** (verified Aug 31, 2026), which handles its own OAuth internally. That path is independent of Vibe's DCR implementation and remains a proven alternative if you hit edge cases.

## What the docs should say

The current documentation limitation note should be updated to reflect reality:

> OAuth is fully supported for MCP servers. For servers requiring OAuth, add a `[mcp_servers.auth]` block with `type = "oauth"` to your `[[mcp_servers]]` entry. Many MCP servers support Dynamic Client Registration (DCR), which requires no pre-registered client credentials. Use `/mcp` to open the MCP server browser, select your server, and choose **Authenticate in browser** to start the OAuth flow.

And for servers that don't support DCR, you'd add the static client credentials:

```toml
[mcp_servers.auth]
type = "oauth"
client_id = "your-pre-registered-client-id"
client_secret = "your-client-secret"  # if required by the server
scopes = ["scope1", "scope2"]
```

But for Upwork, the minimal DCR config above is all you need.

## The seven-step check if your Upwork MCP server isn't connecting

If you're still seeing "no tools" after adding the auth block:

1. **Verify the config** — ensure `name`, `transport`, `url`, and `[mcp_servers.auth]` with `type = "oauth"` are all present
2. **Restart Vibe** — config changes require a full restart to take effect
3. **Check `/mcp list`** — confirm the server appears with `[http]` prefix
4. **Run `/mcp` to open the MCP browser** — select the **upwork** server and choose **Authenticate in browser**
5. **Complete the consent flow** — approve all requested permissions in your browser
6. **Check `/mcp list` again** — the server should now show tool count > 0 (e.g., `[http] 48 tools ● connected`)
7. **Test a tool call** — try `upwork__get_account` to verify connectivity

If step 4 fails with "not configured for OAuth", double-check that the `[mcp_servers.auth]` block is directly under the `[[mcp_servers]]` entry for Upwork, not at the root level or under a different server. As noted in the [official docs](https://docs.mistral.ai/vibe/code/cli/mcp-servers#browse), the `/mcp` command provides the interactive browser interface for managing MCP server connections.

## Why this matters for agency workflows

For my SEO strategy work, Upwork MCP access means:

- **Freelancer discovery** — programmatic access to find specialists for specific tasks (technical SEO audits, content writing, link building)
- **Job automation** — posting, updating, and managing job listings without leaving the CLI
- **Profile integration** — boosting visibility and managing proposals at scale
- **Data-driven hiring** — pulling freelancer metrics and past work to inform hiring decisions

Before this working OAuth setup, the only path was manual API key management or using the Upwork web interface. Now it's a native part of the Vibe workflow: ask for a task, Vibe can query Upwork for the right freelancer, post the job, and manage the process end-to-end.

## Bottom line

The Mistral docs are wrong on this one. OAuth for MCP servers isn't a limitation — it's fully implemented and working. The Upwork MCP server connects with three lines of config and Dynamic Client Registration. The confusion came from stale documentation and a config detail that's easy to overlook.

If you've been holding off on MCP server integrations because of the "OAuth not supported" note, give it another try. The code has moved on.

---

*Questions about your own Vibe or MCP setup? Find me on Mastodon at [@jfrumau@mastodon.social](https://mastodon.social/@jfrumau). The `.vibe/config.toml` used as the basis for this post is [available here](https://github.com/wpvillain/seo-strategy/blob/main/.vibe/config.toml).*
{% endraw %}
