---
layout: post
title: "WP-CLI One-Liner: Generate and Set a Secure Password Without the Shell History Risk"
date: 2026-09-21 09:00:00 +0700
categories: wordpress wp-cli devops security
tags: [wordpress, wp-cli, cli, security, passwords, bash, openssl]
case_category: devops
case_status: documented
---

{% raw %}
The command reads like a haiku, but it solves a problem that bites everybody at least once:

```bash
PASS=$(openssl rand -base64 16) && wp user update admin --user_pass="$PASS" && echo "New password: $PASS"
```

It generates a strong random password, sets it for the `admin` user, and prints it to your terminal — without ever persisting it in your shell history, a script log, or a process list where a shoulder-surfer might spot it.

## The Problem It Solves

The first time most people need to reset a WordPress password from the command line, they do this:

```bash
wp user update admin --user_pass='correct-horse-battery-staple'
```

That works. It also writes the password to `~/.bash_history`, `~/.zsh_history`, or whatever your shell's history file is named. From there it can end up:

- In a backup that gets restored months later
- In a shared CI log if you forget you're in a script
- Visible to anyone with momentary access to your terminal session
- Grepped accidentally by a teammate looking for "admin" in a log file

The second time most people need to do it, they remember the first time and reach for `--prompt`:

```bash
wp user update admin --prompt=user_pass
```

That's better — the password is typed interactively and never hits the history. But it still has friction: it won't run in a script, it's awkward over SSH to a remote host, and you need to manually type a strong password or copy-paste one from a generator, which puts it back on the clipboard where it can leak.

## How the One-Liner Works

```bash
PASS=$(openssl rand -base64 16) && wp user update admin --user_pass="$PASS" && echo "New password: $PASS"
```

Breaking it down:

1. **`openssl rand -base64 16`** generates 16 random bytes and base64-encodes them, producing a 24-character password like `7Xk9m+2vQxYq1LpX9rT8uW4K`. Base64 is URL-safe and avoids the ambiguity of punctuation some systems dislike.

2. **`PASS=$(...)`** captures that output into a shell variable. Variables don't survive the shell session — once you close the terminal or the script exits, the password is gone.

3. **`wp user update admin --user_pass="$PASS"`** updates the user. The quotes around `$PASS` keep the shell from word-splitting or globbing parts of the password.

4. **`echo "New password: $PASS"`** prints it once so you can see it and copy it to your password manager. This is the only time it's visible.

The `&&` chains ensure that if any step fails (OpenSSL missing, `wp` not found, user doesn't exist), the whole thing stops and the password never gets set to a half-finished value.

## Security Notes

This is secure against **history**, but not against **shoulder surfing** or **screen capture**. The password is still displayed on screen for anyone looking at your terminal. For environments where that's a risk, consider:

- Running the command over SSH and only showing the output locally
- Using `wp user reset-password admin --skip-email --porcelain` instead, which also avoids history but only prints the password

It is also **not** secure against **process listing**. For a brief moment the variable's value exists in the process environment. On a shared system where other users can run `ps eww`, this is a vulnerability. For most local or single-user deploy contexts it's fine.

If you need the highest level of paranoia, use WP-CLI's own password generator:

```bash
wp user reset-password admin --porcelain --skip-email
```

This generates a 24-character password internally and prints only the result. It never touches your shell, so it can't leak through history, environment, or process listing. The trade-off is you can't control the length or the character set.

## Variations

**Different user:** Replace `admin` with the username or user ID:

```bash
PASS=$(openssl rand -base64 16) && wp user update 42 --user_pass="$PASS" && echo "New password: $PASS"
```

**Longer password:** Base64 encodes 6 bits per character, so 16 bytes becomes 24 characters. For a longer password, increase the byte count:

```bash
PASS=$(openssl rand -base64 24)  # ~32 characters
PASS=$(openssl rand -base64 32)  # ~44 characters
```

**Alphanumeric only:** Some systems reject special characters. Use `tr` to strip them:

```bash
PASS=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9') && wp user update admin --user_pass="$PASS" && echo "New password: $PASS"
```

**Copy to clipboard automatically** (macOS):

```bash
PASS=$(openssl rand -base64 16) && wp user update admin --user_pass="$PASS" && echo "$PASS" | pbcopy && echo "New password copied to clipboard"
```

**Remote host via SSH:**

```bash
ssh user@example.com "PASS=\$(openssl rand -base64 16) && wp user update admin --user_pass=\"\\$PASS\" && echo \"New password: \$PASS\""
```

That escaping is messy. A cleaner approach is to run the password generation locally and pass only the value:

```bash
PASS=$(openssl rand -base64 16) && ssh user@example.com "wp user update admin --user_pass='$PASS'" && echo "New password: $PASS"
```

**Creating a new user with a generated password:**

```bash
PASS=$(openssl rand -base64 16) && wp user create deploybot bot@example.com --role=administrator --user_pass="$PASS" && echo "New password: $PASS"
```

## Why Not Just Use `--show-password` with `reset-password`?

WP-CLI's `reset-password` command has a `--show-password` flag:

```bash
wp user reset-password admin --show-password
```

This also avoids shell history. The difference is mainly ergonomic: `reset-password` emails the user by default, so you need `--skip-email` if that's not desired. And it uses WP-CLI's own password generator, which may or may not match your preferred length or character set.

The OpenSSL version gives you more control, and it's a pattern you can reuse in other contexts (database passwords, API keys, etc.).

## What This Doesn't Do

- **It doesn't expire old sessions.** After changing a password, existing login sessions for that user remain valid until they expire or the user logs out. For incident response, add `wp user session destroy admin --all`.

- **It doesn't verify the password.** Use `wp user check-password admin 'the-password'` to verify without changing it.

- **It doesn't rotate application passwords.** For API access, use `wp user application-password create admin 'deploy-pipeline'`.

## Real-World Use Cases

**Emergency lockout recovery:** You're handed a site where the admin password is lost, SSH is available, and you need to get back in fast. This is the two-second fix.

**Provisioning scripts:** A deploy or setup script needs to create users with strong passwords. The variable approach keeps them out of script files and logs.

**Client handovers:** You're transferring a site to a new owner and need to set a temporary admin password. Generating it inline means it's never written down anywhere permanent.

**Security incident response:** A password may have been compromised. Rotating it with a one-liner gets it done immediately, and the echo lets you communicate the new password to the affected user through a separate secure channel.

## The Takeaway

```bash
PASS=$(openssl rand -base64 16) && wp user update admin --user_pass="$PASS" && echo "New password: $PASS"
```

It's a small pattern with outsized utility: strong passwords, no history pollution, one copy-paste, and it works identically whether you're local or on a remote server over SSH. Keep it in your back pocket for the next time you need to set a WordPress password from the command line.

This is the kind of small but critical detail we handle day-to-day in WordPress operations work at [Imagewize](https://imagewize.com). If you're building or maintaining WordPress sites and want help with the tooling and workflow around them, [get in touch](https://imagewize.com/contact-us/).

---

*Found a better one-liner? Or hit a case this doesn't cover? Find me on Mastodon at [@jfrumau@mastodon.social](https://mastodon.social/@jfrumau).*
{% endraw %}
