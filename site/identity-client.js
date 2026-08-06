(() => {
  "use strict";

  const script = document.currentScript;
  const scriptOrigin = (() => {
    try { return new URL(script?.src || location.href).origin; }
    catch { return "https://id.hara-lang.org"; }
  })();
  const configuredOrigin = document.querySelector('meta[name="hara-identity-origin"]')?.content?.trim();
  const identityOrigin = configuredOrigin ? new URL(configuredOrigin, location.href).origin : scriptOrigin;
  const roots = () => [...document.querySelectorAll("[data-hara-identity]")];

  const githubIcon = '<svg class="hara-identity__github" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .75a11.25 11.25 0 0 0-3.56 21.92c.56.1.77-.24.77-.54v-2.1c-3.13.68-3.79-1.33-3.79-1.33-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.69.08-.69 1.13.08 1.72 1.16 1.72 1.16 1 1.72 2.63 1.22 3.27.93.1-.73.39-1.22.71-1.5-2.5-.28-5.13-1.25-5.13-5.56 0-1.23.44-2.23 1.16-3.02-.12-.28-.5-1.43.11-2.98 0 0 .95-.3 3.1 1.15a10.7 10.7 0 0 1 5.64 0c2.15-1.46 3.1-1.15 3.1-1.15.61 1.55.23 2.7.11 2.98.72.79 1.16 1.79 1.16 3.02 0 4.32-2.64 5.27-5.15 5.55.4.35.76 1.04.76 2.1v3.11c0 .3.21.65.78.54A11.25 11.25 0 0 0 12 .75Z"/></svg>';
  const logoutIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 5H6.5A2.5 2.5 0 0 0 4 7.5v9A2.5 2.5 0 0 0 6.5 19H10M14 8l4 4-4 4M18 12H9"/></svg>';

  function installStyles() {
    if (document.getElementById("hara-identity-style")) return;
    const style = document.createElement("style");
    style.id = "hara-identity-style";
    style.textContent = `
      .hara-identity{display:inline-flex;align-items:center;gap:.35rem;font-family:var(--hara-font-sans,var(--hara-display,ui-sans-serif,system-ui,sans-serif));line-height:1}
      .hara-identity__account,.hara-identity__logout{display:inline-flex;align-items:center;justify-content:center;min-height:36px;color:var(--hara-text,#f2f4f7);background:var(--hara-surface,var(--hara-panel,#11151b));border:1px solid var(--hara-line,#303640);border-radius:999px;text-decoration:none;font:620 .78rem var(--hara-font-sans,var(--hara-display,ui-sans-serif,system-ui,sans-serif));white-space:nowrap;transition:background 120ms ease,border-color 120ms ease,opacity 120ms ease}
      .hara-identity__account{gap:.45rem;padding:.42rem .7rem}
      .hara-identity__logout{width:36px;padding:0;cursor:pointer}
      .hara-identity__account:hover,.hara-identity__logout:hover{background:var(--hara-surface-raised,#171c24);border-color:var(--hara-line-strong,#48515e)}
      .hara-identity__account:focus-visible,.hara-identity__logout:focus-visible{outline:2px solid var(--hara-signal,var(--hara-cyan,#41f5e4));outline-offset:2px}
      .hara-identity__github,.hara-identity__logout svg{width:17px;height:17px;flex:none}
      .hara-identity__logout svg{fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
      .hara-identity__avatar{width:19px;height:19px;border-radius:50%;object-fit:cover;background:var(--hara-surface-raised,#171c24)}
      .hara-identity[data-state="loading"]{opacity:.72}
      .hara-identity[data-state="signed-out"] .hara-identity__logout{display:none}
      @media(max-width:560px){.hara-identity__account{min-height:34px;padding-inline:.55rem}.hara-identity__logout{width:34px;min-height:34px}.hara-identity__label[data-authenticated="true"]{display:none}}
    `;
    document.head.append(style);
  }

  function automaticMount() {
    if (!document.querySelector('meta[name="hara-identity-auto"]')) return null;
    return document.querySelector(".header .right-group")
      || document.querySelector("header .right-group")
      || document.querySelector("header [data-theme-toggle]")?.parentElement
      || document.querySelector("header");
  }

  function ensureAutomaticRoot() {
    if (roots().length) return;
    const mount = automaticMount();
    if (!mount) return;
    const root = document.createElement("div");
    root.dataset.haraIdentity = "";
    mount.prepend(root);
  }

  function ensureMarkup(root) {
    root.classList.add("hara-identity");
    if (root.querySelector("[data-hara-identity-account]")) return;
    root.innerHTML = `
      <a class="hara-identity__account" data-hara-identity-account aria-label="Sign in with GitHub">
        ${githubIcon}
        <img class="hara-identity__avatar" data-hara-identity-avatar alt="" hidden>
        <span class="hara-identity__label" data-hara-identity-label>Sign in</span>
      </a>
      <button class="hara-identity__logout" data-hara-identity-logout type="button" aria-label="Sign out" title="Sign out">
        ${logoutIcon}
      </button>`;
  }

  function signInUrl() {
    const url = new URL("/github/start", identityOrigin);
    url.searchParams.set("returnTo", location.href);
    return url.href;
  }

  function renderSignedOut(root, configured = true) {
    ensureMarkup(root);
    root.dataset.state = "signed-out";
    const account = root.querySelector("[data-hara-identity-account]");
    const label = root.querySelector("[data-hara-identity-label]");
    const avatar = root.querySelector("[data-hara-identity-avatar]");
    const github = root.querySelector(".hara-identity__github");
    account.href = signInUrl();
    account.removeAttribute("target");
    account.removeAttribute("rel");
    account.setAttribute("aria-label", configured ? "Sign in with GitHub" : "GitHub sign-in is not configured");
    account.toggleAttribute("aria-disabled", !configured);
    label.textContent = "Sign in";
    label.dataset.authenticated = "false";
    avatar.hidden = true;
    avatar.removeAttribute("src");
    if (github) github.hidden = false;
  }

  function renderSignedIn(root, profile) {
    ensureMarkup(root);
    root.dataset.state = "signed-in";
    const account = root.querySelector("[data-hara-identity-account]");
    const label = root.querySelector("[data-hara-identity-label]");
    const avatar = root.querySelector("[data-hara-identity-avatar]");
    const github = root.querySelector(".hara-identity__github");
    account.href = profile.profileUrl || `https://github.com/${encodeURIComponent(profile.login)}`;
    account.target = "_blank";
    account.rel = "noopener noreferrer";
    account.removeAttribute("aria-disabled");
    account.setAttribute("aria-label", `Signed in as ${profile.login} on GitHub`);
    label.textContent = `@${profile.login}`;
    label.dataset.authenticated = "true";
    avatar.src = profile.avatarUrl || `https://avatars.githubusercontent.com/u/${encodeURIComponent(profile.id)}?v=4`;
    avatar.alt = "";
    avatar.hidden = false;
    if (github) github.hidden = true;
  }

  async function refresh() {
    ensureAutomaticRoot();
    installStyles();
    for (const root of roots()) {
      ensureMarkup(root);
      root.dataset.state = "loading";
      renderSignedOut(root, true);
      root.dataset.state = "loading";
    }

    let session;
    try {
      const response = await fetch(new URL("/session", identityOrigin), {
        credentials: "include",
        mode: "cors",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`HARA_IDENTITY_SESSION_${response.status}`);
      session = await response.json();
    } catch {
      for (const root of roots()) renderSignedOut(root, true);
      return null;
    }

    const profile = session?.profile || session?.user;
    for (const root of roots()) {
      if (session?.authenticated && profile?.login && profile?.id) renderSignedIn(root, profile);
      else renderSignedOut(root, session?.configured !== false);
    }
    dispatchEvent(new CustomEvent("hara:identity-change", { detail: session }));
    return session;
  }

  async function signOut() {
    const response = await fetch(new URL("/logout", identityOrigin), {
      method: "POST",
      credentials: "include",
      mode: "cors",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "X-Hara-Request": "sign-out",
      },
    });
    if (!response.ok) throw new Error(`HARA_IDENTITY_LOGOUT_${response.status}`);
    for (const root of roots()) renderSignedOut(root, true);
    dispatchEvent(new CustomEvent("hara:identity-change", {
      detail: { authenticated: false, configured: true, profile: null, user: null, identity: null },
    }));
  }

  document.addEventListener("click", (event) => {
    const button = event.target instanceof Element
      ? event.target.closest("[data-hara-identity-logout]")
      : null;
    if (!button) return;
    event.preventDefault();
    button.disabled = true;
    signOut().catch(() => {}).finally(() => { button.disabled = false; });
  });

  const initialise = () => refresh().catch(() => {});
  document.addEventListener("astro:page-load", initialise);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialise, { once: true });
  else initialise();

  globalThis.HaraIdentity = Object.freeze({
    origin: identityOrigin,
    refresh,
    signOut,
  });
})();
