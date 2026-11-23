// The gallery's copy buttons.
//
// Served as a file rather than inlined. The CSP helmet puts on every answer is `script-src 'self'`
// with no hash and no nonce, so an inline <script> is blocked outright: the button was wired to a
// handler the browser refused to run, and the only sign was a console error on every page load.
(function () {
  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    // The clipboard API needs a secure context. A deployment on plain http still gets a button
    // that works instead of a second console error.
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand('copy');
    } finally {
      document.body.removeChild(area);
    }
    return Promise.resolve();
  }

  document.addEventListener('click', function (event) {
    var button = event.target.closest('.copy-btn');
    if (!button) return;
    var target = document.getElementById(button.dataset.target);
    if (!target) return;
    copy(target.textContent.trim()).then(
      function () {
        button.textContent = '已复制';
        setTimeout(function () { button.textContent = '复制'; }, 1500);
      },
      function () {
        button.textContent = '复制失败';
        setTimeout(function () { button.textContent = '复制'; }, 1500);
      }
    );
  });
})();
