---
layout: post
title: "WordPress Form Spam Without a CAPTCHA: nginx POST-Only Rate Limits + a Small CF7 mu-plugin"
seo_title: "Stop Contact Form 7 spam without CAPTCHA: nginx POST-only limit_req + wpcf7_spam timing/JS-token mu-plugin"
description: "We removed the CAPTCHA from our production contact form after OCR-solvable spam (XEvil) kept passing it. What protects the form now: POST-only nginx rate limits, a timing-trap + JS-token mu-plugin on wpcf7_spam, a honeypot, and Flamingo for auditing. With the configs and code, plus the two nginx gotchas that bit us."
date: 2026-11-22 09:00:00 +0700
categories: wordpress trellis security
tags: [wordpress, contact-form-7, cf7, spam, captcha, nginx, rate-limiting, limit-req, trellis, bedrock, mu-plugin, honeypot, flamingo, wpcf7-spam, security, self-hosted]
case_category: security
case_status: documented
---

Last week we removed the CAPTCHA from the contact form on imagewize.com. Not replaced it — removed it. The form we had was Really Simple CAPTCHA, and our own spam folder had proof it was worthless: submissions from "XEvil 7.0" (a CAPTCHA-solving tool) sailed straight through, because RSC renders plain, low-distortion text images that basic OCR eats for breakfast. A challenge that bots solve and humans squint at is the worst of both worlds.

So the form now runs with no visible challenge at all. Here is everything that stands between a bot and our inbox, layer by layer, all self-hosted — no Google, no Cloudflare, nothing leaves the server. This is a Bedrock/Trellis stack (nginx + PHP-FPM), but layers 2–4 are plain WordPress and work anywhere.

## Layer 1 — nginx rate limiting, POST-only

The first line is at the edge, in `trellis/nginx-includes/all/rate-limit-forms.conf.j2`. Two zones are defined in `nginx.conf`, both keyed on the request method so that only POSTs count:

```nginx
map $request_method $cf7_post_key {
    POST    $binary_remote_addr;
    default "";
}
limit_req_zone $cf7_post_key zone=cf7_post:10m rate=2r/m;

location ~* ^/wp-json/contact-form-7/ {
    limit_req zone=cf7_post burst=5 nodelay;
    limit_req_status 429;
    # ... fastcgi pass
}

location = /contact/ {
    limit_req zone=contact_post burst=3 nodelay;
    limit_req_status 429;
    # ... fastcgi pass
}
```

An empty key is not counted by nginx, so GET requests — page loads, and importantly the `/feedback/schema` GET that Contact Form 7 makes on every page that contains a form — pass through unthrottled. Two details here were learned the hard way:

1. **Counting GETs breaks real users.** The first version keyed the zone on `$binary_remote_addr` alone. CF7's schema GET then ate the budget, real visitors hit 429 on their first retry, and the form just hung on "submitting" with no error. Keying on POST only fixed it.
2. **Changing a zone's key does not reload.** nginx refuses to reload when an existing `limit_req_zone` changes its key, while `nginx -t` still passes — so the old config silently stayed live. Renaming the zone (`cf7_form` → `cf7_post`) forces the new definition in.

Effect: one source IP can sustain at most ~2 submissions per minute; anything faster gets 429s. `burst=5` with `nodelay` lets a human fix a validation error and resubmit a few times without tripping it. The `/contact/` location catches bots that POST the raw HTML form without executing JavaScript.

What this layer **cannot** do: stop low-and-slow spam (one submission every 31 seconds never trips it) or distributed bots (per-IP limits don't aggregate across IPs). That is what the next layers are for.

## Layer 2 — invisible behavioral checks: timing trap + JS token

`site/web/app/mu-plugins/cf7-spam-guard.php`. The form ships two **empty** hidden fields (`iw_spam_ts`, `iw_spam_js`) via `wpcf7_form_hidden_fields`; a footer script then fetches per-visitor tokens from a small REST endpoint and fills them in — only if JavaScript runs. On submit, the `wpcf7_spam` filter flags the submission when the timestamp signature is invalid, the fetch→submit time is under 3 seconds (bots submit near-instantly), or the JS token is empty/unknown (the bot never executed JS, or replayed a token):

```php
const IW_CF7_SPAM_GUARD_BLOCK = true;   // false = log-only
const IW_CF7_SPAM_GUARD_MIN_SECONDS = 3;

// secret from env('IW_CF7_GUARD_SECRET'), falling back to AUTH_KEY
function iw_cf7_guard_secret(): string { /* ... */ }

// mint a fresh signed timestamp + single-use JS token (transient, 10 min TTL)
function iw_cf7_guard_issue(): array {
    $ts = time();
    $js = wp_generate_password(32, false, false);
    set_transient('iw_cf7_js_' . $js, $ts, 600);
    return ['ts' => $ts . '.' . hash_hmac('sha256', (string) $ts, iw_cf7_guard_secret()), 'js' => $js];
}

// per-visitor tokens over REST; never stored in the (page-cached) HTML
add_action('rest_api_init', function () {
    register_rest_route('iw-cf7/v1', '/token', [
        'methods' => 'GET',
        'permission_callback' => '__return_true',
        'callback' => function () {
            $r = new WP_REST_Response(iw_cf7_guard_issue());
            $r->header('Cache-Control', 'no-store, max-age=0');
            return $r;
        },
    ]);
});

// hidden fields ship empty (cache-safe); the script below fills them, i.e. only if JS runs
add_filter('wpcf7_form_hidden_fields', function (array $hidden) {
    $hidden['iw_spam_ts'] = '';
    $hidden['iw_spam_js'] = '';
    $GLOBALS['iw_cf7_guard_form_rendered'] = true;
    return $hidden;
});

add_action('wp_footer', function () {
    if (empty($GLOBALS['iw_cf7_guard_form_rendered'])) return;
    $url = wp_json_encode(esc_url_raw(rest_url('iw-cf7/v1/token')));
    ?><script>
    fetch(<?php echo $url; ?>, {cache: 'no-store', credentials: 'same-origin'})
        .then(r => r.json())
        .then(t => ['ts', 'js'].forEach(k =>
            document.querySelectorAll('input[name="iw_spam_' + k + '"]')
                .forEach(el => el.value = t[k])))
        .catch(() => {});
    </script><?php
});

add_filter('wpcf7_spam', function (bool $spam, WPCF7_Submission $sub) {
    if ($spam) return $spam;
    $posted = $sub->get_posted_data();
    $reasons = [];
    [$ts, $sig] = array_pad(explode('.', (string) ($posted['iw_spam_ts'] ?? ''), 2), 2, '');
    $ts = (int) $ts;
    if ($ts <= 0 || !hash_equals(hash_hmac('sha256', (string) $ts, iw_cf7_guard_secret()), $sig)) {
        $reasons[] = 'bad_timestamp';          // forged/missing timestamp
    } elseif (time() - $ts < IW_CF7_SPAM_GUARD_MIN_SECONDS) {
        $reasons[] = 'fast_submit(' . (time() - $ts) . 's)';
    }
    $js = (string) ($posted['iw_spam_js'] ?? '');
    $key = 'iw_cf7_js_' . $js;
    if ($js === '' || get_transient($key) === false) {
        $reasons[] = 'no_js_token';
    } else {
        delete_transient($key);                 // single use: no replay
    }
    if (!$reasons) return $spam;
    error_log('[cf7-spam-guard] reasons=' . implode(',', $reasons)
        . ' mode=' . (IW_CF7_SPAM_GUARD_BLOCK ? 'block' : 'log-only'));
    return IW_CF7_SPAM_GUARD_BLOCK ? true : $spam;
}, 10, 2);
```

Using `wpcf7_spam` (not `wpcf7_validate`) means a flagged bot still sees the normal "message sent" response — it never learns which check it failed. It lives in `mu-plugins` so a theme switch can't disable it.

**Why the field names being public doesn't break this.** This post ships the tag names `iw_spam_ts` / `iw_spam_js` in the HTML of every page with a form, so assume bots know them. What they can't do is forge the values: the timestamp is HMAC-signed with a server secret, so an old "safe-looking" timestamp fails the signature check, and the JS token is a random per-visitor value held server-side for 10 minutes and deleted on first use — a scraped token works exactly once. The inputs ship empty and only the fetch-and-fill script sets them, so a bot that doesn't execute JavaScript (most of them) can't fill them at all. The residual hole is a headless browser that fetches a token, waits 3+ seconds and submits once per token — that bar is deliberately as high as we can raise it without a third-party service, and the honeypot, rate limits and Flamingo review catch what's left.

**Why the tokens come from a REST endpoint, not the page render.** The first version baked the signed timestamp and JS token into the HTML at render time — and that broke the homepage form, because these pages are served from the nginx FastCGI page cache: every visitor got the *same* token, and since the token is single-use, the first person to submit consumed it and everyone after got `no_js_token`. So the hidden fields now render empty (cache-safe) and the footer script fetches fresh per-visitor tokens from `GET /wp-json/iw-cf7/v1/token` (`Cache-Control: no-store`; `/wp-json/` is already in `skip_cache_uri`). Side effect worth knowing: that token route is not under the `cf7_post` rate-limit zone (which only matches `/wp-json/contact-form-7/`), so it can be hammered — harmless, since minting a token doesn't let you submit (single-use, TTL, timing check still apply), but you can add a `limit_req` on it if the logs show abuse.

We rolled it out **log-only first** (`IW_CF7_SPAM_GUARD_BLOCK = false`), let it record verdicts for days alongside the old CAPTCHA, compared catch rates against Flamingo's spam folder, saw no false positives on real leads, then flipped the constant and deleted the `[captchac]`/`[captchar]` tags from the form. Log-only mode is the right default for any rollout of this kind.

## Layer 3 — honeypot

The `contact-form-7-honeypot` plugin's `[honeypot additional-details]` field stays in the form. It catches the dumb bots that fill every field, costs humans nothing, and needs no third-party script.

## Layer 4 — CF7's own checks + an audit trail

CF7 6.x already marks spam on its own inside the same `wpcf7_spam` pipeline (invalid nonce, unnaturally short user-agent), and our filter runs after those. On top of that, **Flamingo** logs every inbound message, and spam-flagged ones land in its Spam view — so nothing is silently lost and you can audit catch rates and false positives with real data instead of guessing.

## Why not reCAPTCHA or Turnstile?

Constraints first: this site must not send visitor data to US third-party services, which rules out reCAPTCHA; Turnstile is Cloudflare, also a third party, and consent-banner interactions with invisible CAPTCHAs are their own GDPR headache. But the deciding evidence was simpler: the CAPTCHA we had was already being solved. reCAPTCHA v3's real moat is Google's cross-site telemetry, not a cleverer puzzle — at our scale we approximate the same trick (behavioral signals: timing, JS execution) for free, which filters the large majority of opportunistic bots that don't run a full browser. A determined attacker with a headless browser and human-like timing will always cost more to stop; that is the right trade for a lead-gen form, where a lost real inquiry costs more than a bit of spam.

## Monitoring and the leftovers

- Blocked submissions: `grep cf7-spam-guard` in the PHP-FPM error log (each line has the reason, form ID, and mode).
- Caught spam and false positives: Flamingo → Inbound messages / Spam.
- Two housekeeping items after removing RSC: drop `wp-plugin/really-simple-captcha` from `composer.json`, and drop `/contact.*` from `skip_cache_uri` — that exclusion existed only because the CAPTCHA image had to be fresh per page load. It's safe to remove now: the spam-guard tokens are no longer baked into the cached HTML, they're fetched per visitor from the REST endpoint (see above), so the contact page can be full-page cached again.

The short version: rate-limit the volume at nginx (POST-only!), catch the non-humans with timing and a JS token in a mu-plugin, keep a honeypot for the fill-everything bots, and log everything in Flamingo so the day you ask "is this working?" you have numbers, not vibes.
