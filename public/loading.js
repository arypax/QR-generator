(() => {
  function ensureOverlay() {
    let el = document.querySelector(".loading-overlay");
    if (el) return el;
    el = document.createElement("div");
    el.className = "loading-overlay";
    el.innerHTML = `
      <div class="loading-card" role="status" aria-live="polite" aria-busy="true">
        <span class="spinner" aria-hidden="true"></span>
        <div class="loading-text">Загрузка…</div>
      </div>
    `;
    document.body.appendChild(el);
    return el;
  }

  function showLoading() {
    const el = ensureOverlay();
    el.setAttribute("data-open", "1");
  }

  function bind() {
    document.addEventListener("submit", (e) => {
      const form = e.target;
      if (!(form instanceof HTMLFormElement)) return;
      // for important actions show loader
      showLoading();
    });

    document.addEventListener("click", (e) => {
      const a = e.target && e.target.closest ? e.target.closest("a") : null;
      if (!a) return;
      if (a.dataset && a.dataset.loading === "1") showLoading();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();


