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

`site/web/app/mu-plugins/cf7-spam-guard.php` (about 60 lines). On form render it injects two hidden fields via `wpcf7_form_hidden_fields` — a server timestamp and an empty token that a tiny footer script fills in only if JavaScript runs. On submit, the `wpcf7_spam` filter flags the submission when the render→submit time is under 3 seconds (bots submit near-instantly) or the JS token is empty (the bot never executed JS):

```php
const IW_CF7_SPAM_GUARD_BLOCK = true;   // false = log-only
const IW_CF7_SPAM_GUARD_MIN_SECONDS = 3;

add_filter('wpcf7_form_hidden_fields', function (array $hidden) {
    $hidden['iw_spam_ts'] = (string) time();
    $hidden['iw_spam_js'] = '';
    return $hidden;
});

add_action('wp_footer', function () {
    if (!class_exists('WPCF7_ContactForm')) return;
    ?><script>
    document.querySelectorAll('input[name="iw_spam_js"]')
        .forEach(el => el.value = 'js-ok');
    </script><?php
});

add_filter('wpcf7_spam', function (bool $spam, WPCF7_Submission $sub) {
    if ($spam) return $spam;
    $posted = $sub->get_posted_data();
    $reasons = [];
    $ts = (int) ($posted['iw_spam_ts'] ?? 0);
    if ($ts > 0 && (time() - $ts) < IW_CF7_SPAM_GUARD_MIN_SECONDS) {
        $reasons[] = 'fast_submit(' . (time() - $ts) . 's)';
    }
    if (empty($posted['iw_spam_js'])) $reasons[] = 'no_js_token';
    if (!$reasons) return $spam;
    error_log('[cf7-spam-guard] reasons=' . implode(',', $reasons)
        . ' mode=' . (IW_CF7_SPAM_GUARD_BLOCK ? 'block' : 'log-only'));
    return IW_CF7_SPAM_GUARD_BLOCK ? true : $spam;
}, 10, 2);
```

Using `wpcf7_spam` (not `wpcf7_validate`) means a flagged bot still sees the normal "message sent" response — it never learns which check it failed. It lives in `mu-plugins` so a theme switch can't disable it.

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
- Two housekeeping items after removing RSC: drop `wp-plugin/really-simple-captcha` from `composer.json`, and note that `/contact.*` is still excluded from the FastCGI page cache (`skip_cache_uri`) — that exclusion existed because the CAPTCHA image had to be fresh per page load. Keep the exclusion anyway: with a cached page the `iw_spam_ts` timestamp would freeze at cache time and the timing check would measure against the wrong baseline.

The short version: rate-limit the volume at nginx (POST-only!), catch the non-humans with timing and a JS token in a mu-plugin, keep a honeypot for the fill-everything bots, and log everything in Flamingo so the day you ask "is this working?" you have numbers, not vibes.
