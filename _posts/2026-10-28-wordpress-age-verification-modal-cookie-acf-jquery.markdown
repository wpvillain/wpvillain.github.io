---
layout: post
title: "A Cookie-Based Age Gate for WordPress: jQuery Modal, ACF Fields, and One Class to Hide Content"
date: 2026-10-28 19:00:00 +0700
categories: wordpress javascript acf
tags: [wordpress, javascript, jquery, acf, cookies, age-verification, modal]
case_category: development
case_status: documented
---

{% raw %}
Some WordPress sites show promotional blocks for gambling operators, and those blocks must not be shown to younger visitors. The requirement was a modal on the first visit that asks for an age range, remembers the answer, and hides the blocks when the visitor should not see them.

I built it as a small script, a modal template and a stylesheet. This post explains how it works and where it stops being enough. The full script is below. The modal template (`footer.php`) and the stylesheet are in [the wp-ops repository at the commit that last held them](https://github.com/imagewize/wp-ops/tree/ef8c3c2/docs/wordpress-utilities/age-verification).

One limit first: this is a **self-declared** age gate. It records what the visitor clicks. It does not verify anything, and a visitor can click the wrong button, clear the cookie or disable JavaScript. If your jurisdiction requires real age verification, this is not it.

## The rules

Three buttons, three outcomes:

| Choice | Ad blocks | Cookie lifetime |
|---|---|---|
| Under 18 | Hidden | 1 day |
| 18 to 23 | Hidden | 1 day |
| 24 or over | Visitor's choice via a checkbox | 365 days |

The visitor's answer goes into one cookie, `canSeeAds`, with the value `true` or `false`. The short lifetime for younger visitors means the question comes back the next day. The long one for adults means they are asked once a year.

## How it works

The script runs on document ready and does four things.

**1. Show the modal on the first visit.** No `canSeeAds` cookie means no answer yet, so it adds `modal-visible` to the modal and `visible` to the overlay. The `overflow-hidden` class on the body stops the page scrolling behind it.

**2. Handle the buttons.** The two younger buttons set the cookie to `false` for a day, close the modal and hide the blocks. The adult button reads the checkbox, sets the cookie to match for a year, closes the modal, then shows or hides the blocks to match.

**3. Toggle content with one class.** Every block that depends on the answer carries `.code-block`. Hiding adds Bootstrap's `d-none` class, showing removes it:

```js
const hideCasinoHighlightBlocks = () => {
  document.querySelectorAll('.code-block').forEach((element) => {
    element.classList.add('d-none');
  });
};
```

That means the theme needs a `d-none` rule (`display: none !important`). If you do not use Bootstrap, add it yourself.

**4. Apply the stored answer on every page load.** After the modal logic, the script reads the cookie again. `true` shows the blocks, anything else, including no cookie at all, hides them. The default is hidden, which is the safe direction to fail in.

### The whole script

```js
jQuery(document).ready(function () {

  const setCookie = (name, value, days) => {
    var expires = '';
    if (days) {
      var date = new Date();
      date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
      expires = '; expires=' + date.toUTCString();
    }
    document.cookie = name + '=' + (value || '') + expires + '; path=/';
  };

  const getCookie = (name) => {
    return (
      document.cookie
        .split('; ')
        .find((row) => row.startsWith(name + '='))
        ?.split('=')[1] || null
    );
  };
  const modal = document.querySelector('.modal-verification');
  const overlay = document.querySelector('.modal-overlayer');
  const canSeeAds = document.querySelector('#age_verify');


  const hideModal = () => {
    modal.classList.remove('modal-visible');
    overlay.classList.remove('visible');
    document.body.classList.remove('overflow-hidden');
  };

  const hideCasinoHighlightBlocks = () => {
    document.querySelectorAll('.code-block').forEach((element) => {
      if (element) {
        element.classList.add('d-none');
      }
    });
  };

  const displayCasinoHighlightBlocks = () => {
    document.querySelectorAll('.code-block').forEach((element) => {
      if (element) {
        element.classList.remove('d-none');
      }
    });
  };

  if (!getCookie('canSeeAds')) {
    modal.classList.add('modal-visible');
    overlay.classList.add('visible');
  }


  const ageButtons = ['under-18', '18-23'];
  ageButtons.forEach((id) => {
    document.getElementById(id).addEventListener('click', () => {
      setCookie('canSeeAds', 'false', 1);
      hideModal();
      hideCasinoHighlightBlocks();
    });
  });

  document.getElementById('over-24').addEventListener('click', () => {
    const advStatus = canSeeAds.checked ? 'true' : 'false';
    setCookie('canSeeAds', advStatus, 365);
    hideModal();
    if (advStatus === 'false') {
      hideCasinoHighlightBlocks();
    } else {
      displayCasinoHighlightBlocks();
    }
  });


  handleInitialCheckboxState = () => {
    const canSeeAds = getCookie('canSeeAds');
    if (canSeeAds === 'true') {
      displayCasinoHighlightBlocks();
    } else {
      hideCasinoHighlightBlocks();
    }
  };

  handleInitialCheckboxState();
});
```

## The modal template

`footer.php` holds the markup the script expects: the container (`.modal-verification`), the overlay (`.modal-overlayer`), three buttons with the ids `under-18`, `18-23` and `over-24`, and the checkbox `#age_verify`.

The copy comes from Advanced Custom Fields option fields, so site editors can change the wording without a deploy:

- `avs_header_logo`: the logo in the modal header
- `avs_heading`, `avs_subheading`, `avs_description`: the text blocks
- `avs_button_1`, `avs_button_2`, `avs_button_3`: the three button labels
- `avs_verification_check_text`: the checkbox label
- `avs_confirmation_text`: the line at the bottom

If you do not want ACF, copy the markup into your own template and hard-code the text. The script only cares about the ids and classes.

## Installing it

1. Add the script and the stylesheet to your theme.
2. Enqueue them, with jQuery as a dependency of the script:

```php
wp_enqueue_style(
    'age-verification-modal',
    get_template_directory_uri() . '/age-verification/modal.css'
);
wp_enqueue_script(
    'age-verification',
    get_template_directory_uri() . '/age-verification/age-verification.js',
    [ 'jquery' ],
    null,
    true
);
```

3. Output the modal markup in the footer, for example by including `footer.php` from your theme's footer.
4. Add `.code-block` to the blocks that must be gated.

If the modal markup is missing from a page, the script throws on its first `classList` call, because it looks the elements up without a guard. That is fine on a site where the footer is shared everywhere; add a null check if you load the script on pages without the modal.

## Things I would change

- **Full-page caching and the cookie.** The blocks are in the HTML for everyone and hidden after load, so a page cache works. The cost is a flash of the blocks before the script runs. Hiding them with CSS by default and revealing them from the script avoids the flash.
- **Hidden is not removed.** `d-none` hides the blocks but leaves them in the source. Anyone reading the source or running a crawler sees them. If the content must not be served at all, the gate has to be server-side.
- **Global leak.** `handleInitialCheckboxState` is assigned without `const`, so it becomes a global. Harmless, but easy to fix.
- **Accessibility.** A modal needs focus trapping, `role="dialog"`, `aria-modal="true"` and a way to close it with the keyboard. Add them before using this on a production site.

---

*Built something similar, or know a better way to gate content? Find me on Mastodon at [@jfrumau@mastodon.social](https://mastodon.social/@jfrumau).*
{% endraw %}
