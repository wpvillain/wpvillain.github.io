---
layout: post
title: "From Brief to Block Theme with Mistral Vibe: Set Up, HTML/CSS Prototype, Aviendha + Aludra Conversion with One Agent"
date: 2026-11-12 10:00:00 +0700
categories: vibe ai block-themes
tags: [vibe, mistral, ai, ai-agents, block-themes, block-patterns, gutenberg, fse, valet, aludra, aviendha]
case_category: ai
case_status: documented
---

I build new WordPress block themes in five stages, all in Mistral Vibe: set up the project, build the design as a single HTML/CSS file, review it, convert it into a block theme, and do a design pass until the theme matches the file. One agent does the building; a second one only reviews. Each stage is its own session, and every building stage starts with the same command:

```bash
vibe --agent wp-frontend-builder
```

*Updated November 13, 2026: the first version of this post started every stage with `--smart-approve`. That flag does nothing next to a custom agent, so the bakery runs kept stopping for approval on paths outside the project: `/tmp` screenshots, `~/code/aludra`, `~/code/aviendha`, the local site's WordPress files. The fix is a few lines in `~/.vibe/config.toml`, now under [Fewer approval prompts](#fewer-approval-prompts).*

*Updated again the same day, after the bakery design pass: the prompts left over came from shell syntax, not paths, and the fix for those is in the skills, not the config. Also new: screenshots too large for Vibe to show the model, and hover states, which no screenshot shows. See [What still prompts](#what-still-prompts) and [Stage 4](#stage-4-the-design-pass).*

The agent and the skills it loads come from my public [wp-vibe-toolbox](https://github.com/imagewize/wp-vibe-toolbox). This post walks through the stages, the prompt for each, and the mistakes that shaped those prompts. The project's `PROMPTS.md` counts six steps, 0 to 5, because it gives applying the review notes its own number; here review and fix share stage 2.

**What is and is not tested:** the HTML-to-block-theme stages ran end to end on [architect-demo](https://github.com/imagewize/architect-demo), an architecture studio site I built as a test case, over about fifteen runs. Its [`PROMPTS.md`](https://github.com/imagewize/architect-demo/blob/main/PROMPTS.md) records every prompt and what went wrong; the lessons from it are in the skills. The set-up skill (`demo-project-setup`) is new: I wrote it today, after doing the same set-up by hand for a model agency demo. Its first real run, the bakery example below, already changed the order of stage 0 and taught it to look at the photos instead of trusting their shape.

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

### Fewer approval prompts

`--agent` replaces Vibe's default agent, so a `default_agent = "smart-approve"` in your config no longer applies. Adding `--smart-approve` does not bring it back either. Smart approve is an agent of its own: Vibe runs its classifier only while the active agent is `smart-approve`, so `vibe --agent wp-frontend-builder --smart-approve` runs the builder with ordinary prompts (checked with Vibe 3.1.2). The toolbox agents need an allowlist instead.

Most prompts in the bakery runs did not come from risky commands. They came from paths. A command that names a path outside the working directory prompts for that path even when the command itself is allowed, and this workflow lives outside the project folder all the time:

- screenshots go to `/tmp` and are read back for every visual check
- the conversion forks `~/code/aviendha` and copies block markup from `~/code/aludra/patterns/`
- the review loads `probe.html` and `frame.html` from the toolbox folder
- the agent greps the local site's WordPress core and plugin files

Grant those folders once in `~/.vibe/config.toml`, in both the shell and the `read_file` allowlist, with absolute paths, and allow the handful of commands that kept prompting after that:

```toml
[tools.bash]
allowlist = [
    "vibe-path:directory_recursive:/Users/you/code",
    "vibe-path:directory_recursive:/Users/you/.config/valet/Sites",
    "vibe-path:directory_recursive:/Users/you/Desktop",
    "vibe-path:directory_recursive:/private/tmp",
    "sed -n",
    "\"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome\" --headless=new",
    "wp option get",
    "wp option list",
    "wp post list",
    "wp post get",
    "wp plugin list",
    "wp theme list",
    "wp --info",
    # … plus the read-only basics: ls, cat, grep, head, git status, git diff, …
]

[tools.read_file]
allowlist = [
    "vibe-path:directory_recursive:/Users/you/code",
    "vibe-path:directory_recursive:/Users/you/.config/valet/Sites",
    "vibe-path:directory_recursive:/Users/you/Desktop",
    "vibe-path:directory_recursive:/private/tmp",
]
```

What each part is for, and what to watch:

- **`/private/tmp`, not `/tmp`.** On macOS `/tmp` is a link to `/private/tmp`, and Vibe resolves links before it compares, so the grant has to name `/private/tmp`. It then covers `/tmp/…` too. An older `"/private/tmp/*"` entry covers the files but not the folder, so `cd /tmp` still prompts. On Linux, grant `/tmp`.
- **A grant only clears the path check.** The command still needs its own entry, and once allowed it can do anything it can do in that folder. So allow `sed -n`, never `sed`, or `sed -i` edits any file under `~/code` without asking. The same goes for `magick`: it crops screenshots, but it also writes its output without asking, so it could overwrite an image in a theme's `assets/`. I allow it anyway, because the skills now name the one crop command the agent should run (see below), and an unnamed crop step was what produced the worst prompts.
- **Chrome only with `--headless=new` first.** Vibe matches the start of the command, quotes included. A design pass takes a few dozen screenshots, one per width, and that entry covers exactly the way the toolbox writes them. Chrome with a remote-debugging port first still prompts.
- **Read-only wp-cli only.** `wp post update`, `wp option update`, `wp eval` and `wp db` keep prompting, which is what you want.
- **Chains are fine, variables and redirects are not.** Vibe 3.1.2 splits a command on `|`, `;` and `&&` and checks each part, so `grep … | head -5` passes when both are allowed. `$X`, `$(…)` and `>` always prompt, and so does `echo ===`, which Vibe reads as shell syntax. `echo ---` passes, so the agent now separates outputs with that.

For one session, `vibe --add-dir ~/code/aludra` makes a folder part of the working directory instead. A project's own `.vibe/config.toml` allowlist *replaces* the global one, so copy the basics into it if you use one. The full list is in the toolbox's [install notes](https://github.com/imagewize/wp-vibe-toolbox/blob/main/docs/install.md).

With this in place, `--auto-approve` (`--yolo`) is not needed, and I would keep it for throwaway sites only.

### What still prompts

With the folders granted, the bakery design pass still stopped five times, and none of those prompts came from paths:

- `python3 -c "import PIL"`, to find a way to slice screenshots
- a `for` loop with `convert "$f" … "${f%.png}.jpg"`, and a second loop to shrink the slices
- `node --version` plus `import websocket` probes, to write its own DevTools script and hover over buttons
- `python3 - <<'EOF'` with a regex, to pull the button rules out of the page's CSS

The config cannot fix these. Vibe asks for every loop, every `${…}` expansion and every heredoc (`<<` counts as a redirection), whatever the allowlist says. And `python3` or `node` are not read-only commands: the script reads, but the interpreter can write or delete anything, so `python3 *` on the allowlist means any script runs unasked. I keep both off.

What fixes them is a named command in the skill. An agent that is not told how to do a job improvises, and the improvisation is what prompts. The toolbox now gives one allowlisted command for each job:

```bash
# slice a full-page screenshot into numbered tiles, scaled and converted in one step
magick /tmp/shots/site-1440.png -crop 1440x900 +repage -resize 1100x -quality 82 /tmp/shots/seg/site-1440-%02d.jpg
# a frame.html phone shot is 600px wide with the page in the left 390px: crop that first
magick /tmp/shots/site-390.png -crop 390x+0+0 +repage -crop 390x844 +repage -quality 82 /tmp/shots/seg/site-390-%02d.jpg
# the hover rules WordPress generates from theme.json
curl -s https://lindeboom-demo.test/ | grep -o ':hover[^}]*}'
```

`magick`, `curl` and `grep` are on the allowlist, so these run without a prompt. A session started before a skill change still improvises; tell it in the chat once ("no python3, node, heredocs or loops this session") and it usually holds.

## Stage 0: set up the project

Start the agent in `~/code`, where the project folder will be created, and paste the set-up prompt. You don't need to create anything first:

```bash
cd ~/code
vibe --agent wp-frontend-builder
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
- looks at the photos on a numbered contact sheet, one headless Chrome screenshot of all of them, and writes what each one shows into `CREDITS.md`
- names one photo per section, the rest as alternates, and marks off-brief photos as spare so the build skips them
- fits prompt 1 to the photos you have, checks that the hero block in prompt 4 suits the hero photo, and commits

Then open the photos it chose yourself before stage 1. The build writes alt text and picks crops from those descriptions.

Then it gives you the command and prompt for stage 1. If you want no photos at all, write "no photos, use inline SVG drawings" in the set-up prompt and skip the follow-up run.

Three things from the hand-made run are now in the skill:

**Reference sites need words, not just a URL.** I asked for a model agency site "like jimmodels.com", and the prompt passed the URL on as "reference for the feel". Nobody had opened the site, and the build agent may not be able to fetch it: a JavaScript-heavy agency site often comes back almost empty. The skill now asks what to take from each reference (full-bleed images, a model grid with only the name under each photo, black-and-white page chrome) and states that the name, logo, layout and copy are not copied.

**Never let the agent pick stock photos.** A model asked for Unsplash images makes up photo IDs, which give broken images. You download the photos yourself, and the follow-up run checks their orientation with `file images/*.jpg`. In my case all sixteen photos were portrait, while the brief asked for a landscape hero and a landscape campaign strip.

The first real run of the skill added a fourth lesson. My test prompt said "Photos are in ~/code/bakery-demo/images" while that folder did not exist yet. The agent created it empty and would have written prompt 1 for photos that were not there. That led to the order above: set up first, then add the photos, then a follow-up run that reads the credits from the filenames, so you don't create folders or type credits by hand.

**An agent that says it checked the photos may not have.** The first follow-up run sorted 21 bakery photos by shape only, which is what the skill said at the time: a landscape photo of two men with a tablet came out as a hero candidate. I connected the browser extension and asked it to look. It built a contact sheet, scrolled through it in four screenshots, reported that it had "inspected every photo", and rewrote the credits. Most of the new descriptions were wrong. The hero it picked, recorded as "bread and butter on a work table", is a row of mint cupcakes. The "hands kneading dough" photo shows heart-shaped palmiers, while the real kneading photo was listed as "pastry on a worktop". The "shop front" is a tray of doughnuts, and the actual patisserie shop front was filed as a cake card. A strawberry tart was marked spare as a "coffee table scene".

It came out when a single screenshot of the whole sheet, made outside that session, was compared with the credits row by row. My first explanation was the slices: across four scrolled screenshots, a description slid onto the neighbouring filename. The better explanation turned up in my own config. The session ran on GLM-5.3, and in `~/.vibe/config.toml` only one of my models, `mistral-medium-3.5`, has `supports_images = true`. Vibe sends images only to models with that flag. So the agent most likely never received a single photo, and wrote plausible bakery descriptions for all 21. A later GLM session gave it away when a screenshot "came through as a raw image payload (too large to process)".

The skills now check this first. Before any visual step (the photo check, screenshots at set widths, the page review), the agent reads its model's entry in `~/.vibe/config.toml`. Without image support it does not describe anything: it sorts photos by shape only, writes "not checked by eye", and asks you to switch with `/model mistral-medium-3.5` for that step. With image support, the contact sheet is still built so photos cannot be mixed up: numbered tiles with the filename under each image, one screenshot of the whole sheet, a description per tile number before the filename is looked up, and a second look at every photo it chooses for a section.

The practical rule: run the whole workflow on a model that can see. I now use Mistral Large 4 for every stage: Mistral describes it as multimodal, it has a 1M-token context, and with `supports_images = true` in its entry it described the hero photo correctly. GLM 5.3 is text-only. If you use it anyway, switch with `/model` for anything that needs eyes. The preset, with the alias `large-4` used below, is in the toolbox's [install notes](https://github.com/imagewize/wp-vibe-toolbox/blob/main/docs/install.md).

The same run showed a gap in the block map. The brief asks for full-bleed photos, and the map gave the hero `aludra/hero-split`, which puts the photo beside the text. The obvious alternative, `aludra/hero-banner`, is text-only: its `block.json` has no image attribute. A full-bleed photo hero is a `core/cover`, listed as a gap Aludra does not cover. The skill now picks the hero block by what the brief asks for and checks it against the chosen hero photo.

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

**Which model.** I ran the bakery build on GLM-5.3, which is fast at writing HTML and CSS. It cannot see its own screenshots, so it checked the page by measuring instead: contrast of every text pair (it even sampled the hero photo's pixels behind the headline), header height, overflow and the hamburger at six widths. That is a good fallback, but it is not a look. Check the result by eye before stage 2, or let stage 2 do it. On Large 4 with image support, the build can look at its own screenshots.

**The 500px trap.** When I checked the bakery page myself, a 390px screenshot showed the headline running off the edge, the second button cut off and no hamburger. None of it was real. Headless Chrome on macOS will not make its window narrower than 500px, so `--window-size=390` lays the page out at 500px and the screenshot shows only its left 390px. A test page printing `innerWidth` gave 500. At a real 390px the page was fine. The toolbox now takes phone screenshots through `html-page-review/frame.html`, which loads the page in an iframe at the exact width, inside a window that is at least 500px wide:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars --allow-file-access-from-files --virtual-time-budget=6000 --window-size=600,4000 --screenshot=/tmp/page-390.png "file:///Users/you/code/wp-vibe-toolbox/skills/html-page-review/frame.html?target=file:///Users/you/code/bakery-demo/index.html&w=390&h=4000"
```

If you check widths by hand, use your browser's device toolbar, not a small window.

## Stage 2: review, then fix

The second agent reviews the page and writes numbered notes. This stage is a look, so it needs a model that can see images. Start the agent, switch model, then paste the prompt:

```bash
cd ~/code/bakery-demo
vibe --agent ux-designer
```

```
/model large-4
```

```
Load html-page-review and review index.html against the brief in README.md.
```

The skill's `probe.html` and `frame.html` live in the toolbox folder, outside the project. With the `~/code` and `/private/tmp` grants from [Fewer approval prompts](#fewer-approval-prompts) the review runs without stopping; without them, Vibe asks for each file and each screenshot. They are your own files and it only reads and runs them, so "Allow for remainder of this session" is fine.

A good review run measures the page with the probe at 390, 768 and 1440px, takes one screenshot per width through `frame.html`, says "Visual pass: done", and writes notes with a width and a concrete fix each. "Visual pass: not done" means the model could not see the screenshots: switch model and run it again. If it calls Chrome with `--window-size=390` directly, stop it; that is the 500px trap again.

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
  - hero: core/cover with the hero photo full-bleed and the text over it, listed as a gap
  - cakes: aludra/photo-grid, or aludra/carousel (see carousel-portfolio-showcase.php)
  - order form and contact: aludra/contact-section with a Contact Form 7 form, visible labels above each field
Do not hand-build a section with core/group + CSS when an aludra block fits.

Design layer, in this order: block style variations, then theme.json, then header and footer parts rebuilt from index.html (header navigation overlayMenu mobile), and only then the remaining gaps in one commented block at the end of style.css.

Checks, one command per call: php -l, phpcs, sentinel with --url, --user and --pass, the block-name check, and screenshots of index.html and the site at 1440px and 390px, compared section by section.
```

What each part prevents, from the [architect-demo runs](https://github.com/imagewize/architect-demo/blob/main/PROMPTS.md):

- **Naming Mode B up front.** The first conversion slid into a hand-built core-block theme with one Aludra block in it.
- **The hero as `core/cover`, listed as a gap.** No Aludra block holds a full-bleed photo: `aludra/hero-split` puts it beside the text and `aludra/hero-banner` has no image at all. Naming the gap keeps the agent from forcing the closest block.
- **Copying markup from Aludra's own patterns.** Static blocks fail validation when their wrapper differs from `save()` by one class. A pattern that already passes is the fastest way to pass.
- **The design layer in the same run.** The second conversion used Aludra throughout and passed every check, and still looked like the starter theme: orange pill buttons, shadows, dark bands. Only the palette had been ported. Variations first, then `theme.json`, then CSS fixes that, in order of cost.
- **`overlayMenu mobile` spelled out.** A later run rebuilt the header from the prototype and lost the mobile menu.
- **Screenshots.** [Pattern validation]({% post_url 2026-10-30-bedrock-wp-cli-yml-and-pattern-validate-block-pattern-files %}) passes on a page that looks nothing like the source. Only a side-by-side comparison at both widths tells you whether the conversion worked.
- **Large screenshots need slicing and scaling.** A full-page screenshot is about 9,000px tall, and a 1440px-wide image did not come through inline in Vibe: the model saw nothing. The `magick` command above cuts it into 1100px-wide tiles the model can read.
- **"One command per call" and `--user`/`--pass` for sentinel.** One check per call keeps each result readable and keeps the agent from wrapping checks in shell variables or redirects, which always prompt. A bare `npm run validate` prompts for a login and hangs the agent.

The agent reports a table of sections and blocks, the gaps no block covers, and what still differs from `index.html`.

**Which model.** Run the conversion on Mistral Large 4 with image support. A full conversion reads a lot of files, so the 1M context helps, and the same model can then compare the screenshots of `index.html` and the site at 1440px and 390px. Ask for that comparison before you accept the report.

I ran the bakery conversion on GLM 5.3 first. It took a browser screenshot, decided that "images reach me", and reported every section as matching the prototype. Its own screenshots, compared side by side, showed dark, faded hero text on the dark photo, an order form with an extra column and unstyled fields, and three other sections laid out differently. On a text-only model, "what still differs" comes from measurements only, however confident the report sounds.

## Stage 4: the design pass

The report and your own screenshots become a numbered list for one more run on the same branch, so its diff shows only the design changes:

```
Load html-to-block-theme. theme-lindeboom/ does not yet match index.html. Do a design pass so https://lindeboom-demo.test matches index.html, without changing which blocks are used except where noted.

1. Buttons square, ink background, accent on hover, no shadow.
2. Cakes: three columns, not a carousel.
3. Order form: labels above the fields, no placeholders as labels.
```

One point per difference makes the result easy to check against the screenshots. Expect one or two of these passes. The same model does the fixes and the before and after comparison.

**Hover states are not in any screenshot.** On the bakery theme every section looked right, and the primary buttons did nothing on hover. The design darkens the cream button from `#efe1c3` to `#e3d2ac`; the theme kept it cream. The cause was one level of nesting in `theme.json`:

```json
":hover": { "background": "#E3D2AC" }
```

That is valid JSON, and WordPress ignores it. Colours go under `color`, also inside `:hover`:

```json
":hover": { "color": { "background": "var(--wp--preset--color--primary-accent)" } }
```

The generated CSS showed it straight away: `.wp-block-button__link:hover{color: …}` and no `background-color`. So the design pass now compares hover and focus rules from the CSS, element by element: `grep -n -e ':hover' -e ':focus' index.html` for the prototype, the `curl … | grep -o ':hover[^}]*}'` above for what `theme.json` produced, and the same grep on the theme's `style.css` for the design layer. A `theme.json` hover that is missing from the curl output did not apply. Hover over one button by hand at the end; that takes seconds and is the only real check of the result.

## What I would tell myself before the first run

- **Start every stage in a fresh session.** The prompts are written to stand alone, and a long session drifts.
- **Keep `PROMPTS.md` honest.** Write down after each run what went wrong. My skill changes came from those notes, not from planning.
- **"All checks pass" is not done.** Ask for the screenshots.
- **One model that can see, for every stage.** In Vibe, a model only gets images when its entry in `~/.vibe/config.toml` has `supports_images = true`, whatever the model itself can do. Without it, an agent that "checked" a screenshot or a photo did not. Test it once: ask the agent to describe one of your photos.
- **Never trust a phone screenshot from a narrow headless window.** Headless Chrome on macOS stops at 500px; use an iframe at the exact width.
- **Screenshots don't show hover or focus.** Compare those rules from the CSS, and hover over one button yourself.
- **When the agent improvises, the skill is missing a command.** Each prompt for a loop, a heredoc or `python3` pointed at a step no skill had named. Name the command in the skill rather than allowing the interpreter.
- **Grant the folders before the first run, not one prompt at a time.** `~/code`, the Valet sites folder and `/private/tmp` cover almost every prompt in this workflow. `--smart-approve` won't do it for a custom agent.
- **Check the starter and the plugin after each run.** `git status` in both, so a fork that ran a tool in the wrong folder does not leave logs in your starter theme.

The agent, the skills and the prompt templates are public in [wp-vibe-toolbox](https://github.com/imagewize/wp-vibe-toolbox); the prompts for each stage are also in its [agents README](https://github.com/imagewize/wp-vibe-toolbox/blob/main/agents/README.md#running-the-agents). The full run log, including the block theme it produced, is in [architect-demo](https://github.com/imagewize/architect-demo). For which Mistral model to use for which of these stages, see [my model routing post]({% post_url 2026-11-06-mistral-vibe-model-routing-block-theme-patterns-elayne %}).
