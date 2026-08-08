import { cycleTheme, getThemePreference } from "./vendor/visual-language/theme.js";

const labels = { system: "System", light: "Light", dark: "Dark" };
const icons = { system: "◐", light: "☼", dark: "●" };

function syncThemeControls() {
  const preference = getThemePreference();
  const resolved = document.documentElement.dataset.theme || "light";
  const themeColour = document.querySelector('meta[name="theme-color"]');
  if (themeColour) themeColour.setAttribute("content", resolved === "dark" ? "#080a0d" : "#f6f8fa");

  document.querySelectorAll("[data-hara-theme-toggle]").forEach((button) => {
    const label = button.querySelector("[data-hara-theme-label]");
    const icon = button.querySelector("[data-hara-theme-icon]");
    if (label) label.textContent = labels[preference] || labels.system;
    if (icon) icon.textContent = icons[preference] || icons.system;
    button.setAttribute("title", `Theme: ${labels[preference] || labels.system}`);
  });
}

document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  if (!event.target.closest("[data-hara-theme-toggle]")) return;
  cycleTheme();
  syncThemeControls();
});

addEventListener("hara:theme-change", syncThemeControls);
syncThemeControls();
