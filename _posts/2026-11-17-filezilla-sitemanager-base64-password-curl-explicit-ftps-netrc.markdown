---
layout: post
title: "The FTP Password Is Sitting in FileZilla's sitemanager.xml in Base64 — Decode It at Runtime, Wrap curl, and Insist on Explicit FTPS"
seo_title: "FileZilla sitemanager.xml base64 password + curl explicit FTPS with --ssl-reqd and netrc"
description: "FileZilla stores Site Manager passwords base64-obfuscated in ~/.config/filezilla/sitemanager.xml — not encrypted, just encoded. This wraps curl in a small script that decodes the password at runtime, passes it via a throwaway netrc file descriptor instead of the command line, and forces explicit FTP over TLS with --ssl-reqd so credentials and data actually travel encrypted."
date: 2026-11-17 09:00:00 +0700
categories: devops hosting wordpress
tags: [ftp, ftps, curl, filezilla, tls, security, netrc, shared-hosting, deployment, wordpress]
case_category: devops
case_status: documented
---

A shared-hosting WordPress site with no git-based deploy: pushes to production happen through FileZilla, by hand. That works until a coding agent or a shell script needs to fetch one file from production, or upload one mu-plugin — and then you discover the only credential that exists lives behind a GUI. Here is how to get that same password onto the command line without ever pasting it into a command, writing it to disk, or logging it — and how to make the transfers encrypted instead of the plaintext FTP I had been settling for.

## Where FileZilla actually keeps the password

Not in a keychain, in this setup: in `~/.config/filezilla/sitemanager.xml`, as plain XML with a `<Pass>` element per site. The value is base64 — which is an *encoding*, not encryption. Anyone who can read that file can have the password; that is a reason to mind FileZilla's optional master password, and also the reason the approach below works at all.

The shape of one entry looks like this:

```xml
<Server>
    <Host>ftp.sharedhost.example</Host>
    <Port>21</Port>
    <Protocol>0</Protocol>
    <User>user@yourdomain.com</User>
    <Pass>aGVsbG8gd29ybGQtdGhpcy1pcy1iYXNlNjQ=</Pass>
    <Logontype>1</Logontype>
    <Name>mysite</Name>
</Server>
```

Two things I confirmed while working in this real file:

- **Multiple Site Manager entries can target the same live site, and only one of them works.** The stale one failed with `530 Access denied` — a trap if you decode by "first `<Pass>` in the file" instead of by entry name. Always select on `<Name>`, not position, and remember `Protocol` must be `0` (plain FTP) for this port-21 explicit-TLS setup.
- **If FileZilla has a master password configured, `<Pass>` is no longer plain base64.** The decode below will produce garbage and the login will fail with 530. That is the correct failure: fix it by re-entering the password in FileZilla, not by working around it. On this machine no master password is set, so base64 decode is all it takes.

## Decode at runtime, never inline

The password should exist in exactly one place (FileZilla's config) and appear in memory only, per command. A Python one-liner inside `$(...)` does it, selected by site name:

```bash
PASS=$(python3 -c "
import base64, os, xml.etree.ElementTree as ET
t = ET.parse(os.path.expanduser('~/.config/filezilla/sitemanager.xml'))
for s in t.getroot().iter('Server'):
    if s.findtext('Name') == 'mysite':
        print(base64.b64decode(s.findtext('Pass')).decode())
")
```

No echo — sanity-check the length only, with `echo ${#PASS}`. Because the decode happens inside command substitution, shell history records the code, never the value, and nothing lands on disk.

## Do not put it on the command line either

The lazy finish line is:

```bash
curl --user "user@yourdomain.com:$PASS" "ftp://ftp.sharedhost.example/public_html/"
```

That works, but the password becomes a process argument: visible in `ps` for the lifetime of the request, and in any wrapper scripts you build later. curl has a mechanism for exactly this — a `.netrc` file — and you do not need a persistent one. Process substitution gives curl a throwaway file descriptor:

```bash
curl --netrc-file <(printf 'machine ftp.sharedhost.example\nlogin user@yourdomain.com\npassword %s\n' "$PASS") \
  "ftp://ftp.sharedhost.example/public_html/"
```

The netrc travels nowhere (it exists as `/dev/fd/N` for the duration of the call), so `ps` shows only a path, and the password stays in memory.

## The part I had wrong: plain FTP was never good enough

The entry `Protocol>0` means plain FTP, and my first working curl commands used it as-is. It "worked" the same way FileZilla logs in — except FileZilla's GUI, in the default modern configuration, negotiates **explicit FTP over TLS**: it connects on port 21 and then upgrades with `AUTH TLS` before sending credentials. My curl line did not, so I was typing the same password into a session that sent it — and the data channel — in cleartext on a shared host.

curl does explicit FTPS with one flag on a normal `ftp://` URL:

```bash
curl --ssl-reqd ...
```

Add it to the same command and the session upgrades identically to the GUI: credentials and directory data encrypted, certificate verified — if the cert does not check out, `--ssl-reqd` fails closed rather than silently continuing. Do not add `-k` on top of it unless you know exactly why; the flag makes TLS fail loudly, which on a shared host is exactly what you want. (One server I deal with also accepts SFTP/FTPS variations FileZilla lists as separate protocols; `--ssl-reqd` on port 21 matched the working GUI setup here, `ftps://` on port 990 is the implicit-TLS variant and was never in play.)

With that, a production listing verified it end to end — encrypted control + data channel, valid cert, no plaintext anywhere:

```text
drwxr-xr-x   3 ftp ftp   7 Sep  2 03:18 .
drwxr-xr-x  24 ftp ftp  32 Nov 17 02:43 ..
-rw-r--r--   1 ftp ftp 1203 Jul 25  2024 the-mu-plugin.php
```

## The finished wrapper

I keep this as a script checked into the project, so both I and any coding agent use the same safe path instead of re-deriving it:

```bash
#!/usr/bin/env bash
# sharedhost-ftp.sh — curl wrapper for a shared host's FTP,
# forcing explicit FTP over TLS, password decoded at runtime.

set -euo pipefail

HOST="ftp.sharedhost.example"
FTP_USER="user@yourdomain.com"
SITE_NAME="mysite"
SITEMANAGER="$HOME/.config/filezilla/sitemanager.xml"

[ -f "$SITEMANAGER" ] || { echo "no sitemanager.xml" >&2; exit 1; }

PASS=$(python3 - "$SITEMANAGER" "$SITE_NAME" <<'PY'
import base64, sys, xml.etree.ElementTree as ET

path, site = sys.argv[1], sys.argv[2]
for server in ET.parse(path).getroot().iter("Server"):
    if server.findtext("Name") == site:
        print(base64.b64decode(server.findtext("Pass") or "").decode())
        break
else:
    print(f"site '{site}' not found in {path}", file=sys.stderr)
    sys.exit(1)
PY
) || { echo "could not decode password (FileZilla master password set?)" >&2; exit 1; }

[ -n "$PASS" ] || { echo "empty password" >&2; exit 1; }

exec curl --ssl-reqd \
  --netrc-file <(printf 'machine %s\nlogin %s\npassword %s\n' "$HOST" "$FTP_USER" "$PASS") \
  "$@"
```

Usage is curl with an `ftp://` URL after it:

```bash
# list a directory
scripts/sharedhost-ftp.sh "ftp://ftp.sharedhost.example/public_html/wp-content/mu-plugins/"

# fetch one file
scripts/sharedhost-ftp.sh -o /tmp/wp-config.php \
  "ftp://ftp.sharedhost.example/public_html/wp-config.php"

# upload one file (a deploy — same care as any production write)
scripts/sharedhost-ftp.sh -T the-mu-plugin.php \
  "ftp://ftp.sharedhost.example/public_html/wp-content/mu-plugins/"
```

Every call re-decodes from the single source of truth, so changing the password in FileZilla updates the CLI with no second store to forget.

## What to keep in mind

- **base64 is not a secret.** It removes the "casual shoulder-surf" tier only. If that file is in a synced dotfiles repo, it is a credential in git.
- **Select the Site Manager entry by name.** On this host there were two entries for the same FTP account — one stale, one working — and picking by "first match" silently picks the wrong one.
- **Encryption here protects the wire, not the account.** The password is still the password; a shared host still hands FTP accounts to your userspace. Where SFTP with key auth exists, it is the better long-term answer.
- **The decode step is the honest failure point.** Empty output, or a 530 on login, means either the entry name is wrong or FileZilla is storing an encrypted blob under a master password. Both should stop you, not prompt you to start echoing things.

The full flow now: read FileZilla's config through a name-selected, runtime-only decode, hand curl the credentials off the command line via netrc-in-a-fd, and demand TLS upgrade with `--ssl-reqd` — sharing nothing with the FileZilla GUI session, passing nothing plaintext to the server, and leaving no password copy behind anywhere but the one file that already had it.
