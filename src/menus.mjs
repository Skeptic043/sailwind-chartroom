// Makes the File, Edit, View, Voyage and Help menus behave like one desktop menu bar.

const appMenus = [...document.querySelectorAll(".app-menu")];

function closeAppMenus({ restoreFocus = false } = {}) {
  const openMenu = appMenus.find((menu) => menu.open);
  // On a phone the menus are one sheet, which closes with them.
  document.body.classList.remove("menu-open");
  document.getElementById("touch-menu")?.setAttribute("aria-expanded", "false");
  for (const menu of appMenus) {
    menu.open = false;
    menu.querySelector("summary").setAttribute("aria-expanded", "false");
  }
  // Submenus start folded the next time their menu opens.
  for (const submenu of document.querySelectorAll(".menu-sub")) submenu.open = false;
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
    // On a phone every menu is open at once, as sections of one sheet (touch.mjs).
    if (menu.open && !document.body.classList.contains("menu-open")) for (const other of appMenus) if (other !== menu) other.open = false;
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
    }
  });
  menu.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => closeAppMenus()));
  // Checkboxes leave the menu open, so several layers can be switched in one visit.
  menu.querySelectorAll("select").forEach((control) => control.addEventListener("change", () => closeAppMenus()));
}
// Escape closes an open menu wherever focus is, before anything else sees the key: Safari's engine, which
// the macOS app uses, doesn't focus a checkbox when it's clicked, so focus is often outside the menu.
window.addEventListener("keydown", (event) => {
  // A dialog opened over the chart keeps its own Escape.
  if (event.key !== "Escape" || !appMenus.some((menu) => menu.open) || document.querySelector("dialog:modal")) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  closeAppMenus({ restoreFocus: Boolean(document.activeElement?.closest(".app-menu")) });
}, true);
document.addEventListener("pointerdown", (event) => {
  if (event.target.closest(".app-menu, #touch-menu") || (document.body.classList.contains("menu-open") && event.target.closest(".menu-bar"))) return;
  closeAppMenus();
});
