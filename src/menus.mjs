// Makes the File, Edit, View and Help menus behave like one desktop menu bar.

const appMenus = [...document.querySelectorAll(".app-menu")];

function closeAppMenus({ restoreFocus = false } = {}) {
  const openMenu = appMenus.find((menu) => menu.open);
  for (const menu of appMenus) {
    menu.open = false;
    menu.querySelector("summary").setAttribute("aria-expanded", "false");
  }
  if (restoreFocus) openMenu?.querySelector("summary").focus();
}

function openAppMenu(menu, { focusFirst = false } = {}) {
  for (const other of appMenus) {
    const open = other === menu;
    other.open = open;
    other.querySelector("summary").setAttribute("aria-expanded", String(open));
  }
  if (focusFirst) {
    menu.querySelector('.menu-popover button:not([hidden]), .menu-popover select, .menu-popover input:not([type="hidden"])')?.focus();
  }
}

for (const menu of appMenus) {
  const summary = menu.querySelector("summary");
  menu.addEventListener("toggle", () => {
    summary.setAttribute("aria-expanded", String(menu.open));
    if (menu.open) for (const other of appMenus) if (other !== menu) other.open = false;
  });
  menu.addEventListener("pointerenter", () => {
    if (appMenus.some((candidate) => candidate.open) && !menu.open) openAppMenu(menu);
  });
  summary.addEventListener("keydown", (event) => {
    const index = appMenus.indexOf(menu);
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const offset = event.key === "ArrowRight" ? 1 : -1;
      const next = appMenus[(index + offset + appMenus.length) % appMenus.length];
      if (appMenus.some((candidate) => candidate.open)) openAppMenu(next);
      next.querySelector("summary").focus();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      openAppMenu(menu, { focusFirst: true });
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeAppMenus({ restoreFocus: true });
    }
  });
  menu.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !menu.open || event.target === summary) return;
    event.preventDefault();
    event.stopPropagation();
    closeAppMenus({ restoreFocus: true });
  });
  menu.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => closeAppMenus()));
  menu.querySelectorAll("select, input[type=checkbox]").forEach((control) => control.addEventListener("change", () => closeAppMenus()));
}
document.addEventListener("pointerdown", (event) => {
  if (event.target.closest(".app-menu")) return;
  closeAppMenus();
});
