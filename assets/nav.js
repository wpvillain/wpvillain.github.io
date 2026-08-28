/*
 * Mobile nav dropdown (.nav-toggle, a <details>/<summary> in _includes/header.html).
 * If this script fails to load, the <details> element still opens/closes natively —
 * this is progressive enhancement, not a requirement. When it does load, it takes
 * over the toggle explicitly (some mobile browsers are inconsistent re-tapping an
 * open <summary>) and adds the two things <details> can't do on its own: dismiss
 * on an outside tap, and dismiss on Escape.
 */
(function () {
  var toggle = document.querySelector('.nav-toggle');
  if (!toggle) return;
  var summary = toggle.querySelector('summary');
  if (!summary) return;

  summary.addEventListener('click', function (event) {
    event.preventDefault();
    toggle.open = !toggle.open;
  });

  document.addEventListener('click', function (event) {
    if (toggle.open && !toggle.contains(event.target)) {
      toggle.open = false;
    }
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && toggle.open) {
      toggle.open = false;
      summary.focus();
    }
  });
})();
