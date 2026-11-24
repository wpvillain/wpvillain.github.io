---
layout: post
title: "Updating Trellis - WordPress LEMP"
description: "Updating Trellis can be a challenge initially and there is no one way to do it. Lots of people wrote about it at Roots Discourse and on Github. Most o..."
date: 2017-12-29 06:43:16 +0000
categories: wordpress
tags: [trellis, updating, wordpress]
---

Updating Trellis can be a challenge initially and there is no one way to do it. Lots of people wrote about it at <a href="https://discourse.roots.io/t/best-practices-to-update-trellis/5386" target="_blank" rel="noopener">Roots Discourse</a> and <a href="https://github.com/roots/trellis/issues/883#issuecomment-329052189" target="_blank" rel="noopener">on Github</a>. Most of them require some major git foo. Did write about <a href="https://imagewize.com/keeping-your-trellis-server-updated/">updating the Trellis server</a> before, but not on how to maintain Trellis itself. Here is my- manual - take on it.
<h2>Trellis Repository Update</h2>
I first rename the current Trellis folder to trellis-old and git clone the latest Roots Trellis version:
<ul>
 	<li>mv trellis trellis-old</li>
 	<li>git clone --depth=1 git@github.com:roots/trellis.git &amp;&amp; rm -rf trellis/.git</li>
</ul>
That way I can keep the old copy and have the latest so I can copy over changes I need. I also put <em>trellis-old</em> on the <em>.gitignore</em> list with some other directories and files:

```text
.DS_Store
database-backups/
trellis-old/
miscelaneous/
```

<h2>Trellis files to be updated</h2>
Then I make all the changes to files in the following directories:
<ul>
 	<li>group_vars/all</li>
 	<li>group_vars/production</li>
 	<li>group_vars/staging</li>
 	<li>hosts</li>
</ul>
I skipped group_vars/development as there hardly ever is a need for me there. Don't do tweaks in development really as Trellis handles this pretty well out of the box with Vagrant.
<h2>Common Variables</h2>
The group <em>all</em> with common variables alone has:
<ul>
 	<li>mail.yml,</li>
 	<li>main.yml,</li>
 	<li>vault.yml,</li>
 	<li>users.yml</li>
</ul>
to updateMail.yml has the mail details so your Trellis server can send out email. Something like:

{% raw %}
```text
# Documentation: https://roots.io/trellis/docs/mail/
mail_smtp_server: smtp.sendgrid.net:587
mail_admin: admin@domain.com
mail_hostname: domain.com
mail_user: user
mail_password: "{{ vault_mail_password }}" # Define this variable in group_vars/all/vault.yml
```
{% endraw %}

when you are using Sendgrid.

Main has the main vars including some of your own custom ones.I made sure all customizations to PHP settings are added to <em>group_vars/all/main.yml</em>:

```text
php_max_execution_time: 300
php_max_input_vars: 1000
php_memory_limit: 256M
php_post_max_size: 128M
```

In vault.yml the vault mail password is stored. That is needed for sending out email which is mainly set up in mail.yml. Under users.yml you add the server users and the keys used for which we normally use our own Github ones:

```text
https://github.com/jasperf.keys
```

Though users.yml is not hard to set up and admin for admin_user is correct most of the time you do need to make sure all is well and no changes were made.
<h2>Staging and Production</h2>
Then staging and development have two files each that need updating:
<ul>
 	<li>vault.yml</li>
 	<li>wordpress_sites.yml</li>
</ul>
These files do not change much in Trellis, but they contain major details on your WordPress setup so do need to be updated with your customizations properly.

<strong>NB</strong> Did add <em>php_memory_limit: 512M</em> to production and staging, but I guess that could be moved to <em>group_vars/all</em> as well. Still two files each there. So nine files in total.
<h2>Hosts</h2>
Host files for staging and production need their ips updated so they have the ones you added before. This is pretty easy to do and as these files hardly every change you can overwrite them. Example staging hosting file:

```text
# Add each host to the [staging] group and to a "type" group such as [web] or [db].
# List each machine only once per [group], even if it will host multiple sites.
[staging]
 xxx.xxx.x.xxx
[web]
 xxx.xxx.x.xxx
```

