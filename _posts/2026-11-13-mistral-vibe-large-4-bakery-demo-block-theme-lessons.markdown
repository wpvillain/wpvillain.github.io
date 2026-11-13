---
layout: post
title: "Two Days, 22 Pull Requests: What a Bakery Demo Taught Mistral Vibe and Large 4 About Block Themes"
seo_title: "Mistral Vibe + Large 4: Block Theme Lessons From a Demo"
date: 2026-11-13 10:00:00 +0700
categories: vibe ai block-themes
tags: [vibe, mistral, ai, ai-agents, block-themes, theme-json, gutenberg, fse, aludra, aviendha]
case_category: ai
case_status: documented
---

A family bakery in Utrecht wants a homepage. I gave the job to a European agent and a European model, Mistral Vibe running Mistral Large 4, and let it go from a written brief to an HTML/CSS prototype and then to a WordPress block theme built on Aviendha and Aludra. After two days the homepage matches the prototype to the pixel on most of what I measured, the order form still has a bug, and the rest of the site does not exist yet. Along the way, 22 pull requests went into the [wp-vibe-toolbox](https://github.com/imagewize/wp-vibe-toolbox), version 1.17 to 1.21.

This post is about those pull requests: what the run broke, and what I changed so the next run doesn't. How the stages work, with the prompt for each, is in [the earlier post]({% post_url 2026-11-12-mistral-vibe-wp-frontend-builder-brief-to-html-to-block-theme %}). The bakery is invented, and the whole project is now public: [bakery-demo](https://github.com/imagewize/bakery-demo), with every prompt, its result and what I checked afterwards in [`PROMPTS.md`](https://github.com/imagewize/bakery-demo/blob/main/PROMPTS.md).

## Why a European stack

My clients are small businesses in the Netherlands and the rest of the EU. When I build their site with an AI agent, their brief, their copy and sometimes their customer data pass through that agent and the model behind it. Mistral AI is a French company, under the same GDPR and AI Act as my clients. That is one question less when a client asks where their material goes, and I would rather have that answer ready than look it up.

It also has to work, or the argument is moot. Mistral's models have improved a lot this year. This time Large 4 did the conversion and every design round, and the problems below were mostly mine to fix in the skills, not the model's.

I also ran the first build and the first conversion on GLM 5.3. It is fast at HTML and CSS and has improved a lot, but it is text-only and it is not a European model. The text-only part caused the worst mistakes of the project: a "visual check" of 21 photos and a "section-by-section match" of a theme whose hero text was unreadable, both written without the model seeing a single image (details in the earlier post). Everything now runs on Large 4 with `supports_images = true`.

## Where the bakery stands

Done, and measured against the prototype at 390 and 1440px: header, hero, cakes, workshop, about, order band, contact and footer on the homepage, the open mobile menu, hover states and fonts.

Not done:

- **The order form.** The date field has its hint text stacked above it, which pushes the field down out of line with the others. Round 6d moved the hint under its label in both the theme's form file and the Contact Form 7 form, and it still isn't right.
- **Small leftovers:** the Workshop photo is inset 12px too far at 390px (Aludra's split-section padding), the hero's button row gap is 24px against 16px at 390, and the hamburger has no "Menu" label, because core's navigation renders only the icon.
- **Every other page:** no secondary pages, no blog, no contact page.

So about 60% of a small site. The homepage was the hard part, because it set the tokens, the header, the footer and the design layer the other pages will inherit.

## Lesson 1: port tokens by value, never by name

The prototype already uses WordPress names for its tokens, `--wp--preset--color--secondary` and `--wp--preset--spacing--40`, so they map onto `theme.json`. That turned out to be the trap. The names matched, the values didn't.

**Colours.** In the prototype, `secondary` is cream `#f5ebd9`. In the Aviendha fork, `secondary` is brown `#755D43`, and the cream is called `tertiary`. A design-layer rule copied by name painted the open mobile menu brown, with menu text at 2.35:1 contrast.

**Spacing.** The design layer used `spacing--20` to `--80` 38 times. The theme only had the starter's named sizes (`2-x-small` to `x-large`), so WordPress filled the numbered slugs from its own default scale: 0.44 to 5.06rem against the prototype's 0.5 to 6rem. Every padding and gap on the page was 25 to 33% tighter, and nothing looked broken. It just looked slightly off everywhere.

The comparison round found about 45 differences, and three `theme.json` settings explained most of them. The skill now says: before fixing items one by one, look for a token or a global setting that several differences share. And it checks tokens by value, comparing what WordPress serves with the prototype's `:root`:

```bash
curl -s https://lindeboom-demo.test/ | grep -o -e "--wp--preset--spacing--[a-z0-9-]*: [^;]*"
```

The `: ` in the pattern skips the `var()` fallbacks in block CSS, so you only get the definitions.

## Lesson 2: every token fix needed a second setting

Two of the three root-cause fixes didn't work on the first try, and in both cases `theme.json` looked right.

**Font sizes.** The theme had `typography.fluid: true`, so WordPress turned the fixed 17px body size into `clamp(14px, …, 20px)`. Setting `fluid: false` should have fixed it. The served CSS still said `medium: 20px` and `large: 36px`. Core's own default font sizes (`defaultFontSizes`, true unless you say otherwise) overrode the theme's sizes with the same slugs. Large 4 found that itself, by reading `wp_get_global_settings()` instead of the file, and added `"defaultFontSizes": false`.

**Block gap.** `"blockGap": "0"` on the homepage's `main` group emitted `--wp--style--block-gap: 0`, but core's flow rule read the global preset, so each section kept a 32px top margin, visible as cream strips between sections. The fix was `margin-block-start: 0` on the group and its children in the design layer.

The lesson I took: read the served CSS, not `theme.json`. A setting you wrote is a request. What `curl` returns is what the browser gets.

## Lesson 3: the agent's report is a prediction

In round 5d the agent added a "Bestel een taart" button to the open mobile menu and reported that it "fills 20–360px, 62px tall". In the browser it ran from x −36 to 360 and was 96px tall. Core's navigation link is `content-box`, so `width: 100%` plus 28px of padding on each side, and a 62px min-height plus its padding. Two more rounds went by before `box-sizing: border-box` made it right. All checks passed in every one of those rounds.

I was measuring each fix by hand in the browser, which does not scale. So the toolbox now has [`measure.mjs`](https://github.com/imagewize/wp-vibe-toolbox/tree/main/skills/html-page-review): a Node 22 script with no npm packages that opens a page at an exact width in its own headless Chrome, optionally clicks or hovers first, and prints the box, visibility and computed styles per selector as JSON. It works on `file://` and `https://`, so the agent measures the prototype and the site the same way, before and after an edit. A value it did not measure goes in the report as "expected".

On its first run it found three differences nobody had seen by eye: menu links 64px tall instead of 48, rows about 88px apart instead of 56, and the CTA 62px tall instead of 48. Version 1.21 added `--screenshot --full`, after `frame.html` screenshots of the live site came back without any text, because the web fonts missed the virtual-time budget. The script now scrolls the page in viewport steps so lazy images load, and waits for fonts before it measures or captures.

## Lesson 4: compare rounds and apply rounds, never mixed

Round 5b had an open prompt: take screenshots before and after, check every hover state, compare the rest and fix what's off. After 11 minutes and about ten approval prompts, not one file in the theme had changed. The agent spent the time building its own tools: a Python script to slice screenshots, a `for` loop to convert them, then a DevTools script over websockets to hover over buttons.

Round 5c had a list of five exact edits ("move `background` under `color` in `styles.elements.button[":hover"]`"), the instruction to edit first and check afterwards, and no screenshots before editing. Four edits were done within a few minutes, with no approval prompts, and the fifth came back as findings with a question.

The design pass is now two kinds of rounds, each on its own branch in a fresh session:

- **Compare:** a report only, no edits. A numbered list of differences per section, each with both measurements and the likely source file and line, sorted by how visible it is, uncertain ones marked.
- **Apply:** the numbers I pick from that list, as exact edits, measured before and after.

The stage 6 compare round produced the 45-item list, and the three apply rounds after it closed most of it, with the measurements in a table per point.

## Lesson 5: the shell habits the profile couldn't fix

Most approval prompts in this project did not come from risky commands. They came from habits: shell variables, loops, heredocs, `python3 -c` to read a JSON file. Vibe asks for every one of those, whatever the allowlist says. The earlier post covers the folder grants. These are the habits that were left:

- **Shell variables.** Three sessions in a row shortened paths to `C=/tmp/shots/compare` and `CHROME=…`, although the profile said to write paths in full. Each command then prompted. "No shell variables, ever" is now the first line of the agent's shell rules, with full-path examples.
- **Chained heavy commands.** Six `magick` slices of 9,000px screenshots in one call passed Vibe's 30-second shell timeout and were killed. Now it's one heavy command per call, and `default_timeout = 120` in `~/.vibe/config.toml`.
- **JSON through PHP.** The agent validated `theme.json` with `php -r` and `json_decode`, which prompts for `php *`. It now uses the allowlisted `jq`: `jq empty theme.json`, `jq '.settings.typography' theme.json`.
- **`git -C`.** `git -C /path status` does not match an allowlisted `git status`. `cd /path && git status` does, because Vibe checks each part of a chain.
- **Searching for its own tools.** Asked to run `measure.mjs`, the agent ran `find` over my home folder to locate it. The toolbox path is now read from `skill_paths` in the Vibe config.

One rule did not stick from the profile at all: keeping the todo list current. In two rounds out of three, the list stayed at its first item while the agent finished eight points. A rule in the agent profile gets read once at the start and loses to whatever the prompt says. The apply prompt now carries "after each point, mark its todo done" itself, and that works.

## Lesson 6: a heavier heading is a font file, not a font weight

After the spacing and sizes matched, the headings still looked heavier and wider than the prototype at the same weight and size. The hero heading was 857.1px wide on the site and 793.6px in the prototype, and it wrapped differently on a phone.

The prototype loads Fraunces from Google Fonts with its optical-size axis (`opsz`). The theme bundled a Fraunces file with only the weight axis. Replacing it with Fontsource's full variable file and setting `font-optical-sizing: auto` brought the heading to exactly 793.6px, with the same three lines at 390px. Compare the font file, not only the CSS.

## Lesson 7: sometimes the prototype is wrong

Round 6d asked to make the Workshop and About photos smaller and inset, like the prototype. The agent measured first and reported that the inset came from the browser's default `<figure>` margin (`1em 40px`): the prototype's own `figure` rules never matched, because the selectors pointed at the wrong elements. Not a design decision, so I told it to skip the point and fixed the prototype instead. That's the kind of call I want from an agent: question the target before copying it.

## What got better, and what didn't

Better than I expected from Large 4:

- It found the `defaultFontSizes` override itself, from the served settings, when `fluid: false` didn't work.
- The 45-item comparison came with measurements on both sides, a likely source file and line per item, and four items marked as uncertain.
- When a prompt of mine said `get_stylesheet_directory()` where the surrounding code used `get_template_directory_uri()`, it pointed out the mismatch.
- With exact edits and the shell rules in place, rounds 6b and 6c each finished six or seven points in one session, with one or two approval prompts.

Still weak:

- Rules in the agent profile are followed unevenly. The same rule in the prompt holds.
- When a skill doesn't name a command for a job, it improvises, and the improvising is what prompts. The fix is always a named command in the skill, never allowing `python3` or `node`.
- It reports layout values it didn't measure, in the same confident tone as the ones it did.

None of these are specific to Mistral. They are what I'd expect from any agent on a long task. What changed is that a European model now does all of this work in my workflow, from the first HTML to the last measured pixel.

## Next

The order form's date field first, then the secondary pages, the blog and the contact page, on the same toolbox. Those pages should mostly reuse what the homepage set up, which is the real test of whether the tokens are right. I'll add the results to [`PROMPTS.md`](https://github.com/imagewize/bakery-demo/blob/main/PROMPTS.md) as I go.

The toolbox is public: [wp-vibe-toolbox](https://github.com/imagewize/wp-vibe-toolbox), with every change in its [CHANGELOG](https://github.com/imagewize/wp-vibe-toolbox/blob/main/CHANGELOG.md), each one tied to the bakery round that caused it. For which Mistral model to use for which stage, see [my model routing post]({% post_url 2026-11-06-mistral-vibe-model-routing-block-theme-patterns-elayne %}).
