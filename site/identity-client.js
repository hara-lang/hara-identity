(() => {
  "use strict";

  const script = document.currentScript;
  const scriptOrigin = (() => {
    try { return new URL(script?.src || location.href).origin; }
    catch { return "https://id.hara-lang.org"; }
  })();
  const configuredOrigin = document.querySelector('meta[name="hara-identity-origin"]')?.content?.trim();
  const identityOrigin = configuredOrigin ? new URL(configuredOrigin, location.href).origin : scriptOrigin;
  const identityMode = document.querySelector('meta[name="hara-identity-mode"]')?.content?.trim().toLowerCase();
  const popupEnabled = identityMode === "popup" && location.origin !== identityOrigin;
  const roots = () => [...document.querySelectorAll("[data-hara-identity]")];

  const POPUP_QUERY = "hara_identity_popup";
  const POPUP_CHANNEL_PREFIX = "hara-identity-popup:";
  const POPUP_TIMEOUT_MS = 10 * 60 * 1000;
  let activePopup = null;

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
      .hara-identity[data-state="loading"],.hara-identity[data-state="authorizing"]{opacity:.72}
      .hara-identity[data-state="signed-out"] .hara-identity__logout,.hara-identity[data-state="authorizing"] .hara-identity__logout{display:none}
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

  function cleanReturnUrl() {
    const url = new URL(location.href);
    url.searchParams.delete(POPUP_QUERY);
    return url;
  }

  function signInUrl(returnTo = cleanReturnUrl().href) {
    const url = new URL("/github/start", identityOrigin);
    url.searchParams.set("returnTo", returnTo);
    return url.href;
  }

  async function advertisedGlobalLogoutUrl() {
    try {
      const response = await fetch(new URL("/.well-known/hara-session", identityOrigin), {
        credentials: "include",
        mode: "cors",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return null;
      const discovery = await response.json();
      if (typeof discovery?.globalLogoutEndpoint !== "string") return null;
      const endpoint = new URL(discovery.globalLogoutEndpoint, identityOrigin);
      if (endpoint.origin !== identityOrigin || endpoint.pathname !== "/logout/global") return null;
      endpoint.searchParams.set("returnTo", cleanReturnUrl().href);
      return endpoint.href;
    } catch {
      return null;
    }
  }

  function popupNonce() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  }

  function validPopupNonce(value) {
    return typeof value === "string" && /^[a-f0-9]{48}$/.test(value);
  }

  function popupChannelName(nonce) {
    return `${POPUP_CHANNEL_PREFIX}${nonce}`;
  }

  function popupReturnUrl(nonce) {
    const url = cleanReturnUrl();
    url.searchParams.set(POPUP_QUERY, nonce);
    return url.href;
  }

  function popupSignInUrl(nonce) {
    return signInUrl(popupReturnUrl(nonce));
  }

  function signalPopupCompletion() {
    const url = new URL(location.href);
    const nonce = url.searchParams.get(POPUP_QUERY);
    if (!validPopupNonce(nonce)) return false;

    url.searchParams.delete(POPUP_QUERY);
    try { history.replaceState(history.state, "", url); } catch {}

    const detail = { type: "hara:identity-popup-complete", nonce };
    try {
      const channel = new BroadcastChannel(popupChannelName(nonce));
      channel.postMessage(detail);
      channel.close();
    } catch {}
    try {
      const key = popupChannelName(nonce);
      localStorage.setItem(key, String(Date.now()));
      localStorage.removeItem(key);
    } catch {}

    document.documentElement.dataset.haraIdentityPopupComplete = "";
    setTimeout(() => window.close(), 80);
    return true;
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
    account.setAttribute("aria-label", configured
      ? popupEnabled ? "Sign in with GitHub in a popup" : "Sign in with GitHub"
      : "GitHub sign-in is not configured");
    account.toggleAttribute("aria-disabled", !configured);
    label.textContent = "Sign in";
    label.dataset.authenticated = "false";
    avatar.hidden = true;
    avatar.removeAttribute("src");
    if (github) github.hidden = false;
  }

  function renderAuthorizing(root) {
    ensureMarkup(root);
    root.dataset.state = "authorizing";
    const account = root.querySelector("[data-hara-identity-account]");
    const label = root.querySelector("[data-hara-identity-label]");
    const avatar = root.querySelector("[data-hara-identity-avatar]");
    const github = root.querySelector(".hara-identity__github");
    account.href = signInUrl();
    account.setAttribute("aria-label", "GitHub sign-in popup is open");
    account.removeAttribute("aria-disabled");
    label.textContent = "Signing in…";
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
      if (activePopup) renderAuthorizing(root);
      else {
        root.dataset.state = "loading";
        renderSignedOut(root, true);
        root.dataset.state = "loading";
      }
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
      for (const root of roots()) {
        if (activePopup) renderAuthorizing(root);
        else renderSignedOut(root, true);
      }
      return null;
    }

    const profile = session?.profile || session?.user;
    for (const root of roots()) {
      if (session?.authenticated && profile?.login && profile?.id) renderSignedIn(root, profile);
      else if (activePopup) renderAuthorizing(root);
      else renderSignedOut(root, session?.configured !== false);
    }
    dispatchEvent(new CustomEvent("hara:identity-change", { detail: session }));
    return session;
  }

  function popupFeatures() {
    const availableWidth = Math.max(360, Number(screen.availWidth) || 560);
    const availableHeight = Math.max(520, Number(screen.availHeight) || 720);
    const width = Math.min(560, availableWidth - 32);
    const height = Math.min(720, availableHeight - 32);
    const baseLeft = Number.isFinite(window.screenX) ? window.screenX : window.screenLeft || 0;
    const baseTop = Number.isFinite(window.screenY) ? window.screenY : window.screenTop || 0;
    const outerWidth = Number(window.outerWidth) || availableWidth;
    const outerHeight = Number(window.outerHeight) || availableHeight;
    const left = Math.max(0, Math.round(baseLeft + (outerWidth - width) / 2));
    const top = Math.max(0, Math.round(baseTop + (outerHeight - height) / 2));
    return `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`;
  }

  function popupPlaceholder(popup) {
    try {
      popup.document.title = "Sign in to Hara";
      popup.document.documentElement.style.colorScheme = "dark";
      popup.document.body.style.cssText = "margin:0;min-height:100vh;display:grid;place-items:center;background:#080a0d;color:#f2f4f7;font:16px system-ui,sans-serif";
      popup.document.body.textContent = "Opening GitHub sign-in…";
    } catch {}
  }

  function openSignInPopup() {
    if (!popupEnabled) {
      location.assign(signInUrl());
      return null;
    }
    if (activePopup?.window && !activePopup.window.closed) {
      activePopup.window.focus();
      return activePopup.window;
    }

    const nonce = popupNonce();
    const popup = window.open("", `hara_identity_${nonce}`, popupFeatures());
    if (!popup) {
      location.assign(signInUrl());
      return null;
    }

    popupPlaceholder(popup);
    try { popup.opener = null; } catch {}

    let settled = false;
    let channel = null;
    let closePoll = null;
    let timeout = null;
    const storageKey = popupChannelName(nonce);
    const storageListener = (event) => {
      if (event.key === storageKey) finish("storage");
    };
    const messageListener = (event) => {
      if (event?.data?.type === "hara:identity-popup-complete" && event.data.nonce === nonce) finish("broadcast");
    };

    const cleanup = () => {
      if (closePoll) clearInterval(closePoll);
      if (timeout) clearTimeout(timeout);
      removeEventListener("storage", storageListener);
      try { channel?.removeEventListener("message", messageListener); } catch {}
      try { channel?.close(); } catch {}
    };

    const finish = async (reason) => {
      if (settled) return;
      settled = true;
      cleanup();
      activePopup = null;
      if (reason !== "closed") {
        try { if (!popup.closed) popup.close(); } catch {}
      }
      await refresh();
      try { window.focus(); } catch {}
    };

    try {
      channel = new BroadcastChannel(popupChannelName(nonce));
      channel.addEventListener("message", messageListener);
    } catch {}
    addEventListener("storage", storageListener);

    closePoll = setInterval(() => {
      try { if (popup.closed) finish("closed"); } catch {}
    }, 400);
    timeout = setTimeout(() => finish("timeout"), POPUP_TIMEOUT_MS);
    activePopup = { window: popup, nonce, finish };
    for (const root of roots()) renderAuthorizing(root);

    try { popup.location.replace(popupSignInUrl(nonce)); }
    catch { popup.location.href = popupSignInUrl(nonce); }
    try { popup.focus(); } catch {}
    return popup;
  }

  async function signOut() {
    const globalLogout = await advertisedGlobalLogoutUrl();
    if (globalLogout) {
      for (const root of roots()) renderSignedOut(root, true);
      dispatchEvent(new CustomEvent("hara:identity-change", {
        detail: { authenticated: false, configured: true, profile: null, user: null, identity: null },
      }));
      location.assign(globalLogout);
      return;
    }

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

  function unmodifiedPrimaryClick(event) {
    return event.button === 0 && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
  }

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const account = target?.closest("[data-hara-identity-account]");
    if (account) {
      const root = account.closest("[data-hara-identity]");
      if (account.getAttribute("aria-disabled") === "true") {
        event.preventDefault();
        return;
      }
      if (popupEnabled && unmodifiedPrimaryClick(event) && ["signed-out", "authorizing"].includes(root?.dataset.state)) {
        event.preventDefault();
        openSignInPopup();
        return;
      }
    }

    const button = target?.closest("[data-hara-identity-logout]");
    if (!button) return;
    event.preventDefault();
    button.disabled = true;
    signOut().catch(() => { button.disabled = false; });
  });

  signalPopupCompletion();

  const initialise = () => refresh().catch(() => {});
  document.addEventListener("astro:page-load", initialise);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialise, { once: true });
  else initialise();

  globalThis.HaraIdentity = Object.freeze({
    origin: identityOrigin,
    mode: popupEnabled ? "popup" : "redirect",
    refresh,
    signIn: openSignInPopup,
    signOut,
  });
})();
