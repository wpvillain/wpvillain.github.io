---
layout: post
title: "The Administration Email Field Doesn't Change the Administration Email"
date: 2026-09-03 10:00:00 +0700
categories: wordpress wp-cli devops
tags: [wordpress, wp-cli, cli, admin, email, passwords, security, devops]
case_category: devops
case_status: documented
---

I opened Settings → General on a client site this week and found this sitting above the email field:

> **There is a pending change of the admin email to `hallo@example.com`. Cancel**

The change had been made two and a half weeks earlier. My own notes recorded it as *done*. It wasn't done — it had been sitting in limbo the entire time, and the site had been mailing its update notices and fatal-error alerts to the old address the whole while, silently.

The cause isn't a bug. It's that the input box labelled **Administration Email Address** does not write to the `admin_email` option, and never has. This post is the mental model I keep re-deriving, plus the WP-CLI commands for admin email and passwords that I keep half-remembering and looking up again.

## The one line of core that explains it

Here's the field, from `wp-admin/options-general.php`:

```php
<th scope="row"><label for="new_admin_email">Administration Email Address</label></th>
<td><input name="new_admin_email" type="email" id="new_admin_email"
     value="<?php form_option( 'admin_email' ); ?>" class="regular-text ltr" />
```

Look at the mismatch. The input is **named** `new_admin_email`. Its **value** is printed from `admin_email`. So the box shows you the live address, and saves to a completely different option.

Nothing about the UI signals that those are two different places. You type a new address into a field pre-filled with the current one, hit Save, and the page reloads showing... the old address, plus a notice. Most people read that notice once, assume it'll sort itself out, and move on. It doesn't sort itself out.

## What actually happens on save

Saving `new_admin_email` fires an action hooked in `wp-admin/includes/admin-filters.php`:

```php
add_action( 'add_option_new_admin_email',    'update_option_new_admin_email', 10, 2 );
add_action( 'update_option_new_admin_email', 'update_option_new_admin_email', 10, 2 );
```

And that handler (`wp-admin/includes/misc.php`) does this:

```php
function update_option_new_admin_email( $old_value, $value ) {
    if ( get_option( 'admin_email' ) === $value || ! is_email( $value ) ) {
        return;
    }
    $hash            = md5( $value . time() . wp_rand() );
    $new_admin_email = array(
        'hash'     => $hash,
        'newemail' => $value,
    );
    update_option( 'adminhash', $new_admin_email, false );
    // ... then emails a confirmation link to the NEW address
```

So a "change" leaves you with **three** options in the database, not one:

| Option | Holds | Meaning |
|---|---|---|
| `admin_email` | the live address | what WordPress actually mails |
| `new_admin_email` | the requested address | pending, not yet active |
| `adminhash` | `array( hash, newemail )` | the token in the confirmation link |

The swap into `admin_email` only happens when somebody opens the confirmation email **sent to the new address** and clicks the link. If that inbox doesn't exist yet, or belongs to a client who files it under "probably spam," or the site can't send mail reliably in the first place — the change never lands, and the only trace is a notice on a settings page nobody visits.

That last one is worth dwelling on. The confirmation goes to the new address, so a site with broken outbound mail can *never* complete an admin email change through the UI. And a broken-mail site is exactly the site whose admin address you're most likely trying to fix.

## Inspecting the real state

Never trust the settings screen. Ask the database:

```bash
wp option get admin_email
wp option get new_admin_email   # errors if not set — that's the healthy case
wp option get adminhash
```

On the site above, that gave me:

```
admin_email:     jasper@example.com
new_admin_email: hallo@example.com
adminhash:       array ( 'hash' => 'a2bd4e6c…', 'newemail' => 'hallo@example.com' )
```

Two and a half weeks of "done." A one-liner for a fleet:

```bash
for site in site-a site-b site-c; do
  printf '%-12s live=%-28s pending=%s\n' "$site" \
    "$(wp --url="$site" option get admin_email)" \
    "$(wp --url="$site" option get new_admin_email 2>/dev/null || echo '-')"
done
```

## Cancelling a pending change

The **Cancel** link in the admin does exactly two deletes. From `wp-admin/options.php`:

```php
} elseif ( ! empty( $_GET['dismiss'] ) && 'new_admin_email' === $_GET['dismiss'] ) {
    check_admin_referer( 'dismiss-' . get_current_blog_id() . '-new_admin_email' );
    delete_option( 'adminhash' );
    delete_option( 'new_admin_email' );
```

So the CLI equivalent is:

```bash
wp option delete new_admin_email
wp option delete adminhash
```

**Delete both.** Dropping only `new_admin_email` leaves `adminhash` behind, and the confirmation link in that already-sent email stays live — so months later someone can dig it out of an archive folder, click it, and flip your production admin address. Deleting `adminhash` is what actually revokes the token.

### If you're already looking at the notice, just click Cancel

Worth saying plainly, because it's what I *didn't* do: that link is one click, and it does both deletes for you, behind a nonce check. I was staring straight at it and reached for WP-CLI out of habit — two commands to accomplish what the UI had sitting right there under my cursor.

The CLI version earns its keep in the cases where the link isn't an option:

- **You can't log in.** A locked-out admin, or a fresh site handover where nobody has credentials yet.
- **The site can't send mail.** As above, the confirmation goes to the new address, so a broken-mail site can never complete the change through the UI at all. CLI is the only way through.
- **You're auditing rather than fixing.** The notice tells you an address is pending; `wp option get` tells you all three values, which is what you actually need to reason about the state.
- **More than one site.** Nobody clicks through twelve dashboards.
- **It's in a script.** Provisioning, a migration, a handover checklist.

Away from those, the button is the better tool. Knowing the option names is still what lets you *verify* the button did what you think — which is the real reason to know them.

## Setting it for real

If you want the change to take effect *now*, skip the request/confirm dance and write the live option directly:

```bash
wp option update admin_email hallo@example.com
```

No confirmation, no token, no waiting. I verified this on a sandbox — the value changes immediately and no `adminhash` is created:

```
$ wp option update admin_email direct-test@example.com
Success: Updated 'admin_email' option.
$ wp option get adminhash
Error: Could not get 'adminhash' option. Does it exist?
$ wp option get admin_email
direct-test@example.com
```

One side effect to know about: `update_option_admin_email` is hooked to `wp_site_admin_email_change_notification`, which sends a courtesy heads-up to the **old** address. That's usually what you want. Suppress it with the `send_site_admin_email_change_email` filter if you're scripting a bulk change.

### Forcing it does not cancel a pending change

This is the part that will bite you, and it's the reason the two commands above belong together rather than being alternatives.

Writing `admin_email` directly changes the live address. It does **not** touch `new_admin_email` or `adminhash`. If a pending change was already sitting there, it survives untouched:

```
$ wp option update new_admin_email pending@example.com   # pending change exists
$ wp option update admin_email forced@example.com        # force the live value

$ wp option get admin_email
forced@example.com          <- changed
$ wp option get new_admin_email
pending@example.com         <- survived
$ wp option get adminhash
array ( 'hash' => 'd8f404f5…', 'newemail' => 'pending@example.com' )   <- survived
```

Now look at what redeems that token, in `wp-admin/options.php`:

```php
if ( ! empty( $_GET['adminhash'] ) ) {
    $new_admin_details = get_option( 'adminhash' );
    if ( is_array( $new_admin_details )
        && hash_equals( $new_admin_details['hash'], $_GET['adminhash'] )
        && ! empty( $new_admin_details['newemail'] )
    ) {
        update_option( 'admin_email', $new_admin_details['newemail'] );
```

**There is no expiry check.** No timestamp, no comparison against the current `admin_email`, no nonce. The only conditions are that `adminhash` exists and the hash matches. So the confirmation link stays redeemable indefinitely — and when a logged-in administrator eventually digs that mail out of an archive folder and clicks it out of curiosity, WordPress overwrites your forced address with the old pending one and reports success.

There's a nastier variant. The admin notice only renders when the two differ:

```php
if ( $new_admin_email && get_option( 'admin_email' ) !== $new_admin_email ) {
```

So if you force `admin_email` to the *same* address that's pending, the warning disappears from Settings → General while the stale `adminhash` is still sitting in the database, still armed. The UI now looks completely clean and tells you nothing.

The fix is to treat "set the admin email" as three commands, not one:

```bash
wp option update admin_email hallo@example.com
wp option delete new_admin_email
wp option delete adminhash
```

Set the live value, then revoke the token. Deleting `adminhash` is the part that actually disarms it.

And per the section above — if a pending change is already showing in the dashboard, **click Cancel first**. That clears both options in one click, and what's left for the CLI is a single command:

```bash
wp option update admin_email hallo@example.com
```

Order matters slightly, and not in the direction you'd guess. Cancel *then* set is clean. Set *then* cancel also works, but if you force `admin_email` to the same address that's pending, the notice vanishes on reload — so the Cancel link you were about to click disappears from the screen while the armed token is still in the database. Clear the pending change while you can still see it.

### The assumption I had wrong

I went into this believing the confirmation flow was an admin-UI thing — that WP-CLI wrote options "raw" and bypassed it. That's wrong, and I only found out by testing it:

```
$ wp option update new_admin_email trap-test@example.com
Success: Updated 'new_admin_email' option.
$ wp option get adminhash
array (
  'hash' => '464d11e35cea8eee7894c23d5922b7fb',
  'newemail' => 'trap-test@example.com',
)
```

WP-CLI loads the admin includes, so those hooks fire perfectly well from the command line. **The dividing line is the option name, not the interface.** `wp option update new_admin_email` queues a pending change and mails a confirmation link, exactly like the settings form. Only `admin_email` is immediate.

Which means it's entirely possible to create this same stuck state from a deploy script, and never see the notice that would have told you.

## Multisite

Network settings are a separate option in a separate table:

```bash
wp site option get admin_email          # network admin email
wp option get admin_email --url=sub.example.com   # per-site
```

Network-level changes route through `update_network_option_new_admin_email` (`wp-admin/includes/ms-admin-filters.php`) with the same request/confirm shape. Changing a site's admin email does not touch the network's, and vice versa.

## The sibling trap: user profile emails

The exact same pattern guards a user changing **their own** email, which is where the second round of confusion usually comes from. It's stored in user meta rather than options:

```bash
wp user meta get 5 _new_email
# array( 'hash' => '…', 'newemail' => 'new@example.com' )

wp user meta delete 5 _new_email    # = the "Cancel" link on profile.php
```

But there's a catch worth internalizing, from `wp-admin/user-edit.php`:

```php
if ( IS_PROFILE_PAGE && isset( $_GET['newuseremail'] ) && $current_user->ID ) {
```

That `IS_PROFILE_PAGE` guard means the confirmation dance **only applies to users editing themselves**. An administrator editing somebody else's account changes that email instantly, no confirmation. And from the CLI:

```bash
wp user update 5 --user_email=new@example.com   # immediate, always
```

So "changing a user's email needs confirmation" is only true in one specific case. Everywhere else it's instant.

## Passwords, while we're here

The other thing I look up every time.

**Set a known password:**

```bash
wp user update admin --user_pass='correct-horse-battery-staple'
```

That lands in your shell history in plain text. Use the `--prompt` global parameter to type it interactively instead:

```bash
wp user update admin --prompt=user_pass
```

**Generate a strong one instead of inventing it:**

```bash
wp user reset-password admin --show-password
# or, to capture it in a script:
NEW_PASS=$(wp user reset-password admin --porcelain --skip-email)
```

`reset-password` emails the user by default, which is usually right for a real person and wrong for a service account — hence `--skip-email`. `--porcelain` prints only the password, nothing else.

**Create a user with a password up front:**

```bash
wp user create deploybot bot@example.com \
  --role=administrator --user_pass="$(openssl rand -base64 24)"
```

**Verify a password without changing it** — genuinely useful when a client insists their login is broken and you want to know whether it's the password or something else entirely:

```bash
wp user check-password admin 'the-password-they-swear-works'
```

Exit code 0 means valid, 1 means not. Nothing is modified.

**Kick everyone out after a password change.** Changing the password does *not* invalidate existing sessions, which surprises people during an incident response:

```bash
wp user session destroy admin --all
```

**Application passwords** for API and integration access, so you never hand out the real one:

```bash
wp user application-password create admin 'deploy-pipeline' --porcelain
wp user application-password list admin
wp user application-password delete admin <uuid>
```

## The takeaway

Two WordPress settings look like plain text fields and are actually two-phase state machines: the site's administration email, and a user's own email address. Both leave a pending record that is invisible unless you go looking, and both can sit unresolved indefinitely while everything *appears* fine.

So when you change either one, verify the live value afterward rather than trusting the success notice:

```bash
wp option get admin_email && wp option get new_admin_email
```

If the second command errors, you're clean. If it returns an address, you haven't changed anything yet — you've only asked.
