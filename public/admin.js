function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

async function postForm(url, data) {
  const body = new URLSearchParams();
  Object.entries(data).forEach(([k, v]) => body.set(k, String(v ?? "")));
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body
  });
  if (!res.ok) throw new Error(await res.text());
}

function setState(el, text, kind) {
  if (!el) return;
  el.textContent = text || "";
  if (!kind) delete el.dataset.kind;
  else el.dataset.kind = kind;
}

document.addEventListener("DOMContentLoaded", () => {
  const urlEditors = Array.from(document.querySelectorAll(".url-editor[data-update-url]"));

  urlEditors.forEach((editor) => {
    const input = editor.querySelector(".js-target-url");
    const state = editor.querySelector(".js-save-state");
    const updateUrl = editor.getAttribute("data-update-url");
    if (!input || !state || !updateUrl) return;

    let lastValue = input.value;
    const doSave = debounce(async () => {
      const next = input.value;
      if (next === lastValue) return;
      setState(state, "Сохранение…", "saving");
      try {
        await postForm(updateUrl, { target_url: next });
        lastValue = next;
        setState(state, "Сохранено", "ok");
        setTimeout(() => {
          if (state.dataset.kind === "ok") setState(state, "", "");
        }, 1200);
      } catch (e) {
        setState(state, "Ошибка сохранения", "error");
      }
    }, 650);

    input.addEventListener("input", () => {
      setState(state, "Изменено", "dirty");
      doSave();
    });
  });

  const nameEditors = Array.from(document.querySelectorAll(".name-editor[data-update-url]"));

  nameEditors.forEach((editor) => {
    const input = editor.querySelector(".js-name-input");
    const state = editor.querySelector(".js-name-state");
    const updateUrl = editor.getAttribute("data-update-url");
    if (!input || !state || !updateUrl) return;

    let lastValue = input.value;
    const doSave = debounce(async () => {
      const next = input.value;
      if (next === lastValue) return;
      setState(state, "Сохранение…", "saving");
      try {
        await postForm(updateUrl, { name: next });
        lastValue = next;
        setState(state, "Сохранено", "ok");
        setTimeout(() => {
          if (state.dataset.kind === "ok") setState(state, "", "");
        }, 1200);
      } catch (e) {
        setState(state, "Ошибка сохранения", "error");
      }
    }, 650);

    input.addEventListener("input", () => {
      setState(state, "Изменено", "dirty");
      doSave();
    });
  });

  const modal = document.getElementById("delete-modal");
  const deleteForm = modal?.querySelector(".js-delete-form");
  const deleteLabel = modal?.querySelector(".js-delete-label");

  function openModal() {
    if (!modal) return;
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closeModal() {
    if (!modal) return;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;

    const openBtn = t.closest(".js-open-delete");
    if (openBtn) {
      const action = openBtn.getAttribute("data-action") || "";
      const title = openBtn.getAttribute("data-title") || "эту запись";
      if (deleteForm) deleteForm.setAttribute("action", action);
      if (deleteLabel) deleteLabel.textContent = title;
      openModal();
      return;
    }

    if (t.matches("[data-modal-close]") || t.closest("[data-modal-close]")) {
      closeModal();
      return;
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  const searchInput = document.querySelector(".js-search-input");
  const tableRows = Array.from(document.querySelectorAll(".trow"));

  if (searchInput && tableRows.length > 0) {
    searchInput.addEventListener("input", (e) => {
      const query = e.target.value.trim().toLowerCase();
      
      tableRows.forEach((row) => {
        const id = row.querySelector("code")?.textContent?.toLowerCase() || "";
        const name = row.querySelector(".js-name-input")?.value?.toLowerCase() || "";
        const url = row.querySelector(".js-target-url")?.value?.toLowerCase() || "";
        
        const matches = !query || 
          id.includes(query) || 
          name.includes(query) || 
          url.includes(query);
        
        row.style.display = matches ? "" : "none";
      });
    });
  }

  const logoModeRadios = document.querySelectorAll('input[name="logo_mode"].toggle-input');
  const logoFileInput = document.querySelector(".js-logo-file");
  const fileUploadWrapper = logoFileInput?.closest(".file-upload-wrapper");
  const fileName = document.querySelector(".js-file-name");
  const fileRemove = document.querySelector(".js-file-remove");
  
  if (logoModeRadios.length && logoFileInput && fileUploadWrapper) {
    function updateFileDisplay() {
      const file = logoFileInput.files?.[0];
      if (file && fileName && fileRemove) {
        fileName.textContent = file.name;
        fileRemove.style.display = "inline-flex";
      } else if (fileName && fileRemove) {
        fileName.textContent = "";
        fileRemove.style.display = "none";
      }
    }
    
    function toggleFileInput() {
      const customSelected = document.querySelector('input[name="logo_mode"]:checked')?.value === "custom";
      fileUploadWrapper.style.display = customSelected ? "flex" : "none";
      if (!customSelected) {
        logoFileInput.value = "";
        updateFileDisplay();
      }
    }
    
    if (logoFileInput) {
      logoFileInput.addEventListener("change", updateFileDisplay);
    }
    
    if (fileRemove) {
      fileRemove.addEventListener("click", (e) => {
        e.preventDefault();
        logoFileInput.value = "";
        updateFileDisplay();
      });
    }
    
    logoModeRadios.forEach((radio) => {
      radio.addEventListener("change", toggleFileInput);
    });
    toggleFileInput();
  }
});


