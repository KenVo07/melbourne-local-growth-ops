const roots = document.querySelectorAll("[data-foundation-search]");

for (const root of roots) {
  const trigger = root.querySelector("[data-foundation-search-open]");
  const dialog = root.querySelector("[data-foundation-search-dialog]");
  const form = root.querySelector("[data-foundation-search-form]");
  const query = root.querySelector("[data-foundation-search-query]");
  const submit = root.querySelector("[data-foundation-search-submit]");
  const status = root.querySelector("[data-foundation-search-status]");
  const results = root.querySelector("[data-foundation-search-results]");

  if (
    !(trigger instanceof HTMLButtonElement) ||
    !(dialog instanceof HTMLDialogElement) ||
    !(form instanceof HTMLFormElement) ||
    !(query instanceof HTMLInputElement) ||
    !(submit instanceof HTMLButtonElement) ||
    !(status instanceof HTMLElement) ||
    !(results instanceof HTMLUListElement)
  ) {
    continue;
  }

  trigger.addEventListener("click", () => {
    dialog.showModal();
    query.focus();
  });
  dialog.addEventListener("close", () => trigger.focus());
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    dialog.close();
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      dialog.close();
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const searchTerm = query.value.trim();
    results.replaceChildren();
    if (searchTerm === "") {
      status.textContent = "No matching public website sections were found.";
      return;
    }

    submit.disabled = true;
    submit.textContent = "Searching…";
    status.textContent = "Searching public website content…";
    try {
      const pagefind = await import("/pagefind/pagefind.js");
      await pagefind.init();
      const response = await pagefind.search(searchTerm);
      const resolved = await Promise.all(
        response.results.slice(0, 8).map((result) => result.data()),
      );
      for (const result of resolved) {
        const item = document.createElement("li");
        const link = document.createElement("a");
        link.href = result.url;
        link.textContent = result.meta.title || "Website section";
        link.addEventListener("click", () => {
          dialog.close();
          const hash = result.url.includes("#")
            ? result.url.slice(result.url.indexOf("#") + 1)
            : "";
          requestAnimationFrame(() => {
            const target = document.getElementById(hash);
            target?.focus({ preventScroll: true });
            target?.scrollIntoView({ block: "start" });
          });
        });
        item.append(link);
        results.append(item);
      }
      status.textContent = resolved.length === 0
        ? "No matching public website sections were found."
        : `${resolved.length} ${resolved.length === 1 ? "result" : "results"} found.`;
    } catch {
      status.textContent =
        "Search is temporarily unavailable. Use the section navigation instead.";
    } finally {
      submit.disabled = false;
      submit.textContent = "Search";
    }
  });
}
