---
layout: post
title: "Git Rename Branch"
description: "To rename a git branch, for example when one branch is too far behind and you quickly add a new one, you can rename your branch locally, remove it on..."
date: 2020-05-14 02:34:30 +0000
categories: devops
tags: [branch, devops, rename, wordpress]
---

<p>To rename a git branch, for example when one branch is too far behind  and you quickly add a new one, you can rename your branch locally, remove it on remote and then upload the renamed branch as a new one. You can do that using this code</p>

```bash
git branch -m old_branch new_branch # Rename branch locally
git push origin :old_branch # Delete the old branch
git push --set-upstream origin new_branch # Push the new branch, set local branch to track the new remote
```

<p>props <a href="https://gist.github.com/lttlrck/9628955">lttlrck</a></p>

<p>The command with <code>--</code></p>

```bash
git checkout k8 --
```

<p>may be needed to switch to new branch locally due to error</p>

```
fatal: 'k8' could be both a local file and a tracking branch.
Please use -- (and optionally --no-guess) to disambiguate
```

<p>This happened when we recreated the same branch and tried to use it locally.</p>

<p></p>

<p><br> </p>

<div class="wp-block-group has-tertiary-background-color has-background" style="border-left-color:#10b981;border-left-width:4px;padding-top:1.5rem;padding-right:1.5rem;padding-bottom:1.5rem;padding-left:1.5rem">
<h3 class="wp-block-heading">Need Help with a Sage or WordPress Project?</h3>

<p>We work with agencies and freelance developers on Sage theme builds, WordPress migrations, and white-label development. Whether you need hands-on help or just a second opinion on architecture, we're available for short-term and ongoing engagements.</p>

<ul class="wp-block-list">
<li>Sage 10 / 11 theme builds and migrations</li>

<li>Composer, Vite, and build process troubleshooting</li>

<li>White-label WordPress development for agencies</li>

<li>Code reviews and technical consulting</li>
</ul>

<div class="wp-block-buttons">
<div class="wp-block-button"><a class="wp-block-button__link has-base-color has-primary-background-color has-text-color has-background wp-element-button" href="https://imagewize.com/contact/?service=sage-development" style="border-radius:8px">Get a Quote</a></div>

<div class="wp-block-button is-style-outline"><a class="wp-block-button__link wp-element-button" href="https://imagewize.com/services/wordpress-development/" style="border-radius:8px">View WordPress Services</a></div>
