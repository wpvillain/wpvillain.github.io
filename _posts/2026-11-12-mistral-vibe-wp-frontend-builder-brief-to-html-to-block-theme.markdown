---
layout: post
title: "From Brief to Block Theme with Mistral Vibe: Set Up, HTML/CSS Prototype, Aviendha + Aludra Conversion with One Agent"
date: 2026-11-12 10:00:00 +0700
categories: vibe ai block-themes
tags: [vibe, mistral, ai, ai-agents, block-themes, block-patterns, gutenberg, fse, valet, aludra, aviendha]
case_category: ai
case_status: documented
---

I build new WordPress block themes in three stages, all in Mistral Vibe with one agent: set up the project, build the design as a single HTML/CSS file, then convert that file into a block theme. Each stage is its own session, started with the same command:

```bash
vibe --agent wp-frontend-builder --smart-approve
```

The agent and the skills it loads come from my public [wp-vibe-toolbox](https://github.com/imagewize/wp-vibe-toolbox). This post walks through the stages, the prompt for each, and the mistakes that shaped those prompts.

**What is and is not tested:** the HTML-to-block-theme stages ran end to end on [architect-demo](https://github.com/imagewize/architect-demo), an architecture studio site I built as a test case, over about fifteen runs. Its [`PROMPTS.md`](https://github.com/imagewize/architect-demo/blob/main/PROMPTS.md) records every prompt and what went wrong; the lessons from it are in the skills. The set-up skill (`demo-project-setup`) is new: I wrote it today, after doing the same set-up by hand for a model agency demo. Its first real run, the bakery example below, already changed the order of stage 0.

## Why HTML first

A block theme is the wrong place to design. Every change goes through `theme.json`, block markup that has to match the serializer, and a reload in the editor. A single `index.html` with embedded CSS is fast to change and fast to review, and a screenshot of it is the target the block theme has to match.

So the prototype is built with the conversion in mind:

- Design tokens as `--wp--preset--*` custom properties, so they map one-to-one onto `theme.json`.
- One `<section>` per future block pattern, marked with an HTML comment.
- No `url()` background images (those become Cover blocks), real copy, and a hamburger menu under 1024px.

## The pieces

| Piece | What it is |
|---|---|
| `wp-frontend-builder` | A Vibe agent profile: a role prompt plus the list of skills it may load (`enabled_skills`) and when to load which |
| Skills | Instruction folders the agent loads on demand: `demo-project-setup`, `frontend-design`, `design-system-library`, `no-ai-design-slop`, `html-to-block-theme` and about a dozen more |
| `ux-designer` | A second agent that reviews the prototype and writes numbered notes to `REVIEW.md`, without touching the page |
| [Aviendha](https://github.com/imagewize/aviendha) | My lean FSE starter theme, forked and renamed per client |
| [Aludra](https://github.com/imagewize/aludra) | My block plugin: hero, carousel, photo grid, contact section and other `aludra/*` blocks with their own patterns |

The conversion has two modes. **Mode A** converts the HTML into a standalone theme from core blocks. **Mode B** forks Aviendha and builds every section from Aludra blocks, with core blocks only for the gaps. I use Mode B for client sites, because the client gets blocks they can edit instead of groups with class names.

## Installing it

Point Vibe at the skills in `~/.vibe/config.toml`:

```toml
skill_paths = ["~/code/wp-vibe-toolbox/skills"]
```

Then copy the agent profiles to where Vibe looks for them, and repeat this after every `git pull`:

```bash
rsync -a ~/code/wp-vibe-toolbox/agents/ ~/.vibe/agents/
```

`--agent` replaces Vibe's default agent, so a `default_agent = "smart-approve"` in your config no longer applies. That is why every command in this post passes `--smart-approve` again: it classifies each tool call and only asks for approval on the risky ones.

## Stage 0: set up the project

Start the agent in `~/code`, where the project folder will be created, and paste the set-up prompt. You don't need to create anything first:

```bash
cd ~/code
vibe --agent wp-frontend-builder --smart-approve
```

```
Load demo-project-setup. Set up ~/code/bakery-demo for Bakkerij Lindeboom, Utrecht (invented): a family bakery, 12 people, since 1987. Audience: neighbourhood customers and office caterers. Main actions: "Order a cake" and "Visit the shop". Tone: warm, plain Dutch. Sections: header, hero, cakes, workshop, about, order form (name, email, date, cake, message), contact, footer. References: example.com, take the full-bleed photos and the name-only captions; do not copy anything else. Photos come later. Mode B, local site lindeboom-demo, theme slug lindeboom. Ask before creating a GitHub repository.
```

The set-up run creates the project and the site:

- `README.md` holds the brief. The review agent checks the page against it in stage 2.
- `images/CREDITS.md` lists the photos to download: how many, which orientation, for which section.
- `PROMPTS.md` has one ready-to-paste prompt per stage, each with the exact `vibe --agent` command to start it, and an empty result line to fill in after each run.
- `scripts/resize-images.sh` resizes the photos to at most 1600px wide.
- A Laravel Valet site with `wp valet new`, plus Aludra and Contact Form 7 for Mode B, checked for a `200`.
- A first commit, and a private GitHub repository only if you say yes.

It does not build. It ends with the list of photos to download and the prompt for a short follow-up run.

**Then add the photos.** Download them from Unsplash into `~/code/bakery-demo/images` and keep Unsplash's own filenames, such as `rafaella-mendes-diniz-AoL-mVxprmk-unsplash.jpg`. Start a fresh session in the project folder and paste:

```
Load demo-project-setup. Photos added to images/: fill in CREDITS.md, fit prompt 1 to the photos and commit.
```

The follow-up run:

- resizes the photos and reads their sizes, so it knows which are portrait and which landscape
- fills in `CREDITS.md` from the filenames: the photographer is the name part, the photo ID the last 11 characters before `-unsplash`, so the link is `https://unsplash.com/photos/AoL-mVxprmk`
- leaves the credit blank for a file that does not follow Unsplash's naming, instead of guessing, and asks you to check names that lost their accents (`fulop-adam` is probably Fülöp Ádám)
- gives each photo a section by its orientation, fits prompt 1 to the photos you have, and commits them

Then it gives you the command and prompt for stage 1. If you want no photos at all, write "no photos, use inline SVG drawings" in the set-up prompt and skip the follow-up run.

Three things from the hand-made run are now in the skill:

**Reference sites need words, not just a URL.** I asked for a model agency site "like jimmodels.com", and the prompt passed the URL on as "reference for the feel". Nobody had opened the site, and the build agent may not be able to fetch it: a JavaScript-heavy agency site often comes back almost empty. The skill now asks what to take from each reference (full-bleed images, a model grid with only the name under each photo, black-and-white page chrome) and states that the name, logo, layout and copy are not copied.

**Never let the agent pick stock photos.** A model asked for Unsplash images makes up photo IDs, which give broken images. You download the photos yourself, and the follow-up run checks their orientation with `file images/*.jpg`. In my case all sixteen photos were portrait, while the brief asked for a landscape hero and a landscape campaign strip.

The first real run of the skill added a fourth lesson. My test prompt said "Photos are in ~/code/bakery-demo/images" while that folder did not exist yet. The agent created it empty and would have written prompt 1 for photos that were not there. That led to the order above: set up first, then add the photos, then a follow-up run that reads the credits from the filenames, so you don't create folders or type credits by hand.

**Valet details.** `wp valet new` already sets up HTTPS, so `valet secure` is not needed. But if your projects folder is not parked in Valet, the new site gets Valet's own 404 page until you run `valet link` in its folder. Mine is not parked: all my sites are linked one by one.

The Aludra plugin is symlinked into the site rather than installed:

```bash
ln -s ~/code/aludra ~/code/lindeboom-demo/wp-content/plugins/aludra
```

The site then runs my working copy of Aludra. A block fix shows on the next page load, and the conversion agent copies block markup from the same version the site runs, which matters because Aludra's blocks are static and their markup must match `save()` exactly. The flip side: anything written through the site's plugin folder lands in the Aludra repository, so check its `git status` after a run.

## Stage 1: the HTML/CSS prototype

A fresh session, then paste prompt 1 from `PROMPTS.md`. Shortened:

```
Build the homepage for a family bakery as one self-contained index.html with embedded CSS.

Brief: (name, audience, main actions, tone, references with what to take from each)

This is a homepage, not a landing page. Sections: (in order, forms with their fields).

Images: use only the files in images/, as <img> with width, height and alt text. No url() backgrounds, no external image URLs.

Minimal questions: state your assumptions at the top of your reply, then build.

Design: load design-system-library and check the Food & Beverage category for a fitting system; adapt it, never copy a brand. If none fits, load frontend-design and pick one anchor. Fonts open-licence and available as woff2. Lock the tokens as --wp--preset--* custom properties. One <section> per future block pattern. Mobile-first, accessible, a hamburger menu under 1024px. Run the no-ai-design-slop gate before you hand off.
```

Every line is there because something went wrong without it:

- **"A homepage, not a landing page"** stops the `landing-page` skill from narrowing the page to one conversion goal.
- **"Minimal questions"** makes the agent state its assumptions and build, instead of asking ten questions first.
- **One design source** (a named system from `design-system-library`, or one `frontend-design` anchor) keeps it from mixing three looks on one page.
- **`no-ai-design-slop`** is a quality gate against the generic AI look: gradient blobs, three icon cards, "Elevate your…" headings.
- **The hamburger** is in the prompt because the architect prototype had none, and the conversion then copied the missing menu into the theme as "never collapse".

## Stage 2: review, then fix

The second agent reviews the page and writes numbered notes:

```bash
vibe --agent ux-designer --smart-approve
```

```
Load html-page-review and review index.html against the brief in README.md.
```

Back in `wp-frontend-builder`, apply a few notes at a time:

```
Read index.html and REVIEW.md. Apply review notes 1–3 to index.html. Don't edit REVIEW.md. When done, list per note what you changed.
```

Commit after each round you like, and `git restore index.html` the ones you don't. Small rounds keep the diff readable.

## Stage 3: convert to a block theme

On a branch, in a fresh session. The prompt is long because it names every decision the agent got wrong on the architect site. These are the parts that matter:

```
Load html-to-block-theme and work in Mode B (Aviendha fork + Aludra blocks). Read references/forking-a-starter-theme.md, references/composing-with-aludra.md and references/mobile-navigation.md before writing any file.

Create theme-lindeboom/ as a fork of ~/code/aviendha and build the homepage as one pattern composed from aludra/* blocks. For every section, copy the block's markup from ~/code/aludra/patterns/ and change only the content:
  - hero: aludra/hero-banner or aludra/hero-split
  - cakes: aludra/photo-grid, or aludra/carousel (see carousel-portfolio-showcase.php)
  - order form and contact: aludra/contact-section with a Contact Form 7 form, visible labels above each field
Do not hand-build a section with core/group + CSS when an aludra block fits.

Design layer, in this order: block style variations, then theme.json, then header and footer parts rebuilt from index.html (header navigation overlayMenu mobile), and only then the remaining gaps in one commented block at the end of style.css.

Checks, one command per call: php -l, phpcs, sentinel with --url, --user and --pass, the block-name check, and screenshots of index.html and the site at 1440px and 390px, compared section by section.
```

What each part prevents, from the [architect-demo runs](https://github.com/imagewize/architect-demo/blob/main/PROMPTS.md):

- **Naming Mode B up front.** The first conversion slid into a hand-built core-block theme with one Aludra block in it.
- **Copying markup from Aludra's own patterns.** Static blocks fail validation when their wrapper differs from `save()` by one class. A pattern that already passes is the fastest way to pass.
- **The design layer in the same run.** The second conversion used Aludra throughout and passed every check, and still looked like the starter theme: orange pill buttons, shadows, dark bands. Only the palette had been ported. Variations first, then `theme.json`, then CSS fixes that, in order of cost.
- **`overlayMenu mobile` spelled out.** A later run rebuilt the header from the prototype and lost the mobile menu.
- **Screenshots.** [Pattern validation]({% post_url 2026-10-30-bedrock-wp-cli-yml-and-pattern-validate-block-pattern-files %}) passes on a page that looks nothing like the source. Only a side-by-side comparison at both widths tells you whether the conversion worked.
- **"One command per call" and `--user`/`--pass` for sentinel.** Vibe asks for approval on chained commands even when each part is allowed, and a bare `npm run validate` prompts for a login and hangs the agent.

The agent reports a table of sections and blocks, the gaps no block covers, and what still differs from `index.html`.

## Stage 4: the design pass

The report and your own screenshots become a numbered list for one more run on the same branch, so its diff shows only the design changes:

```
Load html-to-block-theme. theme-lindeboom/ does not yet match index.html. Do a design pass so https://lindeboom-demo.test matches index.html, without changing which blocks are used except where noted.

1. Buttons square, ink background, accent on hover, no shadow.
2. Cakes: three columns, not a carousel.
3. Order form: labels above the fields, no placeholders as labels.
```

One point per difference makes the result easy to check against the screenshots. Expect one or two of these passes.

## What I would tell myself before the first run

- **Start every stage in a fresh session.** The prompts are written to stand alone, and a long session drifts.
- **Keep `PROMPTS.md` honest.** Write down after each run what went wrong. My skill changes came from those notes, not from planning.
- **"All checks pass" is not done.** Ask for the screenshots.
- **Check the starter and the plugin after each run.** `git status` in both, so a fork that ran a tool in the wrong folder does not leave logs in your starter theme.

The agent, the skills and the prompt templates are public in [wp-vibe-toolbox](https://github.com/imagewize/wp-vibe-toolbox); the prompts for each stage are also in its [agents README](https://github.com/imagewize/wp-vibe-toolbox/blob/main/agents/README.md#running-the-agents). The full run log, including the block theme it produced, is in [architect-demo](https://github.com/imagewize/architect-demo). For which Mistral model to use for which of these stages, see [my model routing post]({% post_url 2026-11-06-mistral-vibe-model-routing-block-theme-patterns-elayne %}).
