---
layout: post
title: "WordPress Database Backup When You Only Have FTP (No SSH, No CPanel, No Plesk)"
date: 2026-09-21 14:00:00 +0700
categories: wordpress backup security devops
Tags: [wordpress, backup, database, ftp, php, security, mysql, wpdb]
case_category: devops
case_status: documented
---

{% raw %}
You have FTP access to a WordPress site, a password for `wp-config.php`, and nothing else — no SSH, no CPanel, no Plesk, no phpMyAdmin. The database needs a backup right now. This is the DIY PHP script method that works when every other door is locked.

**Scope note:** this backs up the *database* only — posts, options, users, terms, everything in MySQL. It does not touch `wp-content/uploads`, themes, or plugin files. If you need a full-site backup, use FTP to also download those directories; the database is just the part you can't grab as a folder copy.

## The Constraints

When you only have FTP, the usual tools are off the table:

- **No `wp db export`** — WP-CLI requires shell access
- **No `mysqldump`** — command line only
- **No phpMyAdmin** — not installed, and you can't install it
- **No adminer.php** — same problem: no upload path for a new tool
- **No CPanel/Plesk backups** — no control panel at all

What you *do* have: the ability to upload a PHP file to the site root, trigger it via a browser, and download the result. That is enough.

## The DIY PHP Script Method

Create a file named `backup-db.php` with this content:

```php
<?php
require('wp-load.php');

$db = new wpdb(DB_USER, DB_PASSWORD, DB_NAME, DB_HOST);
$tables = $db->get_results('SHOW TABLES', ARRAY_N);
$output = '';

foreach ($tables as $table) {
    $table_name = $table[0];
    
    // Table structure
    $output .= "--\n-- Table: $table_name\n--\n";
    $output .= "DROP TABLE IF EXISTS `$table_name`;\n";
    $create = $db->get_row("SHOW CREATE TABLE `$table_name`");
    $output .= $create->{'Create Table'} . ";\n\n";
    
    // Table data
    $rows = $db->get_results("SELECT * FROM `$table_name`");
    foreach ($rows as $row) {
        $output .= "INSERT INTO `$table_name` VALUES(";
        $output .= implode(',', array_map(function($val) use ($db) {
            return is_null($val) ? 'NULL' : $db->prepare('%s', $val);
        }, (array)$row));
        $output .= ");\n";
    }
}

$filename = 'wp-content/backup-' . date('Y-m-d-His') . '.sql';
file_put_contents($filename, $output);

echo "Backup complete. Download: <code>/wp-content/{$filename}</code>";
```

### Step-by-Step

1. **Create the file** locally with the code above
2. **Upload it** to the site root via FTP (same directory as `wp-config.php`)
3. **Access it in your browser:** `https://example.com/backup-db.php`
4. **Download the backup** from `/wp-content/backup-YYYY-MM-DD-HHMMSS.sql` via FTP
5. **Delete the script immediately** — this is critical (see Security Notes below)

### What It Does

The script connects using the same credentials WordPress itself uses (`DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_HOST` from [`wp-config.php`](https://developer.wordpress.org/apis/wp-config-php/)), via WordPress's own [`wpdb`](https://developer.wordpress.org/reference/classes/wpdb/) class, then:

1. Lists every table in the database
2. For each table: writes a `DROP TABLE IF EXISTS` statement, the full `CREATE TABLE` definition, and every row as an `INSERT` statement
3. Escapes every value with [`wpdb::prepare()`](https://developer.wordpress.org/reference/classes/wpdb/prepare/) before writing it, so quotes, newlines, and other special characters in post content don't break the dump
4. Saves the complete SQL dump to `wp-content/backup-YYYY-MM-DD-HHMMSS.sql`
5. Outputs a message with the exact filename to download

This produces a standard MySQL dump that can be restored with `mysql -u user -p db_name < backup.sql` or imported via phpMyAdmin, Adminer, or any other MySQL client.

### Verify the Backup Before You Delete Anything

Don't trust the dump blind. Before deleting the script or the original data, do a quick sanity check via FTP or by eyeballing the file:

- **File size isn't zero or suspiciously tiny** for the site's size
- **Table count matches** — the number of `-- Table:` comment lines should equal the number of tables you'd expect (check against `SHOW TABLES` output if unsure)
- **It ends cleanly** — open the last few KB and confirm the final `INSERT` statement looks complete, not cut off mid-row (a sign the script hit a timeout or memory limit)

If any of these look wrong, don't delete the live data or overwrite an older backup — re-run with the per-table or gzip variant below instead.

## Security Notes — READ THIS

**This script is a live SQL credential exposure while it exists on the server.**

- Anyone who guesses or finds the URL `example.com/backup-db.php` can trigger a backup — and in the process, they confirm that `wp-config.php` credentials work, which is valuable reconnaissance
- The script itself contains no credentials (it pulls them from `wp-config.php`), but it *proves* those credentials are valid to anyone who can reach it
- The backup file lands in a web-accessible directory (`wp-content/`). If the filename is predictable, an attacker can download the entire database without authentication

**Mitigation:**

- Use a **non-obvious filename** — not `backup-db.php`, not `dump.php`, not `backup.php`. Something like `x73k2p90.php` that won't be guessed
- **Write the dump outside the web root if you can.** Many shared hosts put `public_html` (or `htdocs`/`www`) as a subfolder of your FTP home directory, with sibling folders that aren't served over HTTP. If your FTP account can navigate one level up, point `$filename` at something like `../backup-db.sql` instead of `wp-content/backup-db.sql` — the dump is then unreachable by URL no matter what it's named
- **Delete the script immediately** after the backup completes and you've downloaded the file
- **Download the backup immediately** and then delete it from the server as well — don't leave SQL dumps in web-accessible directories
- Consider **adding a simple authentication gate** (see Variations below)

See also the [Hardening WordPress](https://wordpress.org/documentation/article/hardening-wordpress/) guide for the broader set of practices this fits into.

## Variations

### Faster for Large Databases: mysqldump via PHP exec()

If the host has [`mysqldump`](https://dev.mysql.com/doc/refman/8.0/en/mysqldump.html) available on the system path and PHP's [`exec()`](https://www.php.net/manual/en/function.exec.php) or [`shell_exec()`](https://www.php.net/manual/en/function.shell-exec.php) is not disabled, a one-liner is faster and more reliable for large databases:

```php
<?php
require('wp-load.php');
$filename = 'wp-content/backup-' . date('Y-m-d-His') . '.sql';
exec("mysqldump --user=" . escapeshellarg(DB_USER) . " --password=" . escapeshellarg(DB_PASSWORD) . " --host=" . escapeshellarg(DB_HOST) . " " . escapeshellarg(DB_NAME) . " > " . escapeshellarg($filename));
echo "Backup complete. Download: <code>/wp-content/{$filename}</code>";
```

**Note:** Many shared hosts disable `exec()` and the shell functions for security reasons. Test it first — if you get an empty file or a 500 error, fall back to the `wpdb` method.

### Basic Authentication Gate

Add a simple check to prevent unauthorized triggering:

```php
<?php
// ADD THIS AT THE TOP
$valid_token = 'your-secret-token-here-12345';
if (empty($_GET['token']) || $_GET['token'] !== $valid_token) {
    header('HTTP/1.0 404 Not Found');
    exit;
}

require('wp-load.php');
// ... rest of the script unchanged
```

Then access via: `https://example.com/backup-db.php?token=your-secret-token-here-12345`

**Warning:** This is *not* cryptographic security — the token is visible in the URL and in server logs. But it stops casual guessing and bots.

### Gzip Compression for Large Databases

For large sites where the SQL dump might exceed PHP memory limits or FTP upload limits, add gzip compression with PHP's [`gzopen()`](https://www.php.net/manual/en/function.gzopen.php)/[`gzwrite()`](https://www.php.net/manual/en/function.gzwrite.php):

```php
<?php
require('wp-load.php');
$db = new wpdb(DB_USER, DB_PASSWORD, DB_NAME, DB_HOST);
$tables = $db->get_results('SHOW TABLES', ARRAY_N);

$filename = 'wp-content/backup-' . date('Y-m-d-His') . '.sql.gz';
$fp = gzopen($filename, 'w9');

foreach ($tables as $table) {
    $table_name = $table[0];
    gzwrite($fp, "--\n-- Table: $table_name\n--\n");
    gzwrite($fp, "DROP TABLE IF EXISTS `$table_name`;\n");
    $create = $db->get_row("SHOW CREATE TABLE `$table_name`");
    gzwrite($fp, $create->{'Create Table'} . ";\n\n");
    
    $rows = $db->get_results("SELECT * FROM `$table_name`");
    foreach ($rows as $row) {
        gzwrite($fp, "INSERT INTO `$table_name` VALUES(");
        gzwrite($fp, implode(',', array_map(function($val) use ($db) {
            return is_null($val) ? 'NULL' : $db->prepare('%s', $val);
        }, (array)$row)));
        gzwrite($fp, ");\n");
    }
}

gzclose($fp);
echo "Backup complete. Download: <code>/wp-content/{$filename}</code>";
```

This reduces the file size by ~70-80%, which can mean the difference between a downloadable backup and one that times out or exceeds FTP limits.

### Per-Table Backup for Memory-Constrained Hosts

If you hit memory limits on very large tables, process tables one at a time and flush:

```php
<?php
require('wp-load.php');
$db = new wpdb(DB_USER, DB_PASSWORD, DB_NAME, DB_HOST);
$tables = $db->get_results('SHOW TABLES', ARRAY_N);

foreach ($tables as $table) {
    $table_name = $table[0];
    $filename = 'wp-content/backup-' . $table_name . '-' . date('Y-m-d-His') . '.sql';
    
    $output = "--\n-- Table: $table_name\n--\n";
    $output .= "DROP TABLE IF EXISTS `$table_name`;\n";
    $create = $db->get_row("SHOW CREATE TABLE `$table_name`");
    $output .= $create->{'Create Table'} . ";\n\n";
    
    $rows = $db->get_results("SELECT * FROM `$table_name`");
    foreach ($rows as $row) {
        $output .= "INSERT INTO `$table_name` VALUES(";
        $output .= implode(',', array_map(function($val) use ($db) {
            return is_null($val) ? 'NULL' : $db->prepare('%s', $val);
        }, (array)$row));
        $output .= ");\n";
    }
    
    file_put_contents($filename, $output);
    echo "Saved: <code>/wp-content/{$filename}</code><br>";
}
echo "Done. Download all files from /wp-content/";
```

This creates one file per table, avoiding the memory spike of holding the entire database in a single string.

### Raising Limits: Fighting Timeouts and Memory Caps

Before reaching for the per-table variant, it's often enough to ask PHP for more room at the top of the script — if the host's PHP configuration allows overrides:

```php
<?php
require('wp-load.php');
ini_set('memory_limit', '512M');
set_time_limit(300); // 5 minutes; some hosts ignore this if safe mode-style restrictions are in place
```

See [`ini_set()`](https://www.php.net/manual/en/function.ini-set.php) and [`set_time_limit()`](https://www.php.net/manual/en/function.set-time-limit.php). Some shared hosts hard-cap these via `php.ini` or `.user.ini` regardless of what the script requests — if the dump still cuts off, that's your signal to switch to the per-table or gzip approach instead.

## Alternatives That *Don't* Work in This Scenario

It's worth noting what you *can't* do with only FTP:

| Method | Why It Fails |
|--------|--------------|
| [`wp db export`](https://developer.wordpress.org/cli/commands/db/export/) | Requires WP-CLI, requires shell access |
| `mysqldump` directly | Requires shell access |
| phpMyAdmin | Requires installation or pre-existing access |
| Adminer | Same — needs to be uploaded and configured |
| CPanel/Plesk backup | No control panel available |
| Host-provided backups | Often unavailable or outdated on cheap shared hosts |

The PHP script method is one of the few that works within the FTP-only constraint.

## Real-World Use Cases

**Emergency backup before a migration:** You're moving a client site to new hosting, the old host only provides FTP, and you need a fresh database snapshot before pointing DNS. This gets you the dump in under 5 minutes.

**Debugging a live site:** Something is wrong with the database and you need to inspect it locally. You can't get SSH access quickly, but FTP works. Upload the script, grab the dump, restore to a local MySQL instance, and debug without touching the live site.

**Recovery after a hack:** A site has been compromised and you suspect the database was tampered with. The host won't grant SSH access. This method lets you pull a clean dump (assuming the attack didn't also compromise `wp-config.php` credentials) for forensic analysis.

**Client with restrictive hosting:** A client is on a budget host that only provides FTP. They need a database backup before a plugin update. This is the only method that doesn't require upgrading their hosting plan.

## Limitations

- **Speed:** The `wpdb` method is slow for large databases (100MB+). Each row is fetched and serialized individually in PHP. The `mysqldump` variant is much faster, but it's often blocked.
- **Memory:** Large tables can exhaust PHP memory limits. The per-table variant helps, or use gzip to reduce in-memory size.
- **Reliability:** If the script times out mid-execution, the backup may be incomplete. For hosts with short PHP `max_execution_time`, the per-table approach is more resilient.
- **Character encoding:** The script uses `wpdb->prepare()` which handles escaping, but ensure your database and PHP are using the same character set (usually utf8mb4).

## The Takeaway

When all you have is FTP, the DIY PHP script is your lifeline. It's not elegant, it's not fast for huge databases, and it demands strict cleanup discipline — but it works, and it's saved more than one project from a hosting dead-end.

The complete pattern:

```
1. Create backup-db.php with the wpdb script
2. Upload to site root via FTP
3. Visit https://example.com/backup-db.php
4. Download the .sql from /wp-content/
5. DELETE backup-db.php immediately
```

This is exactly the kind of constraint-driven problem solving we do day-to-day in WordPress operations work at [Imagewize](https://imagewize.com). If you're managing WordPress sites on restrictive hosting and want help building tooling that works within those limits, [get in touch](https://imagewize.com/contact-us/).

---

*Hit a hosting scenario this doesn't cover? Or found a better FTP-only backup method? Find me on Mastodon at [@jfrumau@mastodon.social](https://mastodon.social/@jfrumau).*
{% endraw %}
