/* global Services, Cc, Ci, Zotero */
const KEYCHAIN_HOST  = "chrome://zotero-autotagger";
const KEYCHAIN_REALM = "Anthropic API Key";
const KEYCHAIN_USER  = "anthropic";

function keychainGet() {
  try {
    const logins = Services.logins.findLogins(KEYCHAIN_HOST, null, KEYCHAIN_REALM);
    return logins.length ? logins[0].password : "";
  } catch (e) { return ""; }
}

function keychainSet(apiKey) {
  try {
    const loginInfo = Cc["@mozilla.org/login-manager/loginInfo;1"].createInstance(Ci.nsILoginInfo);
    loginInfo.init(KEYCHAIN_HOST, null, KEYCHAIN_REALM, KEYCHAIN_USER, apiKey, "", "");
    const existing = Services.logins.findLogins(KEYCHAIN_HOST, null, KEYCHAIN_REALM);
    if (existing.length) {
      Services.logins.modifyLogin(existing[0], loginInfo);
    } else {
      Services.logins.addLogin(loginInfo);
    }
  } catch (e) {
    Zotero.debug(`ZoteroAutoTagger prefs: keychain write failed: ${e.message}`, "error");
  }
}

function keychainRemove() {
  try {
    const existing = Services.logins.findLogins(KEYCHAIN_HOST, null, KEYCHAIN_REALM);
    for (const login of existing) Services.logins.removeLogin(login);
  } catch (e) {}
}

function initPane() {
  const bulkBtn = document.getElementById("autotagger-bulk-btn");
  if (!bulkBtn) return false;

  Zotero.debug("ZoteroAutoTagger: prefs pane initialising");

  const input        = document.getElementById("autotagger-api-key");
  const status       = document.getElementById("autotagger-status");
  const skipChk      = document.getElementById("autotagger-skip-tagged");
  const progressFill = document.getElementById("autotagger-progress-fill");
  const progressWrap = document.getElementById("autotagger-progress-wrap");
  const progress     = document.getElementById("autotagger-progress");

  input.value = keychainGet();

  bulkBtn.addEventListener("click", async () => {
    Zotero.debug("ZoteroAutoTagger: bulk-tag button clicked");
    progress.textContent = "Starting…";
    try {
      if (typeof Zotero === "undefined" || !Zotero.AutoTagger) {
        progress.textContent = "Error: AutoTagger not loaded. Restart Zotero and try again.";
        return;
      }
      if (!keychainGet()) {
        progress.textContent = "No API key set — enter your Anthropic API key above first.";
        return;
      }

      bulkBtn.disabled = true;
      progressFill.style.width = "0%";
      progressWrap.style.display = "block";
      progress.textContent = "Counting items…";

      const { tagged, skipped } = await Zotero.AutoTagger.tagAllItems({
        skipTagged: skipChk.checked,
        onProgress(done, total, wasSkipped) {
          progressFill.style.width = `${Math.round((done / total) * 100)}%`;
          progress.textContent = wasSkipped
            ? `Skipping… ${done} / ${total}`
            : `Tagging… ${done} / ${total}`;
        },
      });
      progressFill.style.width = "100%";
      progress.textContent = `Done. Tagged ${tagged} item${tagged !== 1 ? "s" : ""}, skipped ${skipped}.`;
    } catch (e) {
      progress.textContent = `Error: ${e.message || String(e)}`;
    } finally {
      bulkBtn.disabled = false;
    }
  });

  input.addEventListener("change", () => {
    const val = input.value.trim();
    if (val) {
      keychainSet(val);
    } else {
      keychainRemove();
    }
    status.style.display = "block";
    setTimeout(() => { status.style.display = "none"; }, 2000);
  });

  return true;
}

// Try immediately in case the pane HTML is already in the document.
// If not (Zotero injects pane fragments lazily), watch for the element to appear.
if (!initPane()) {
  Zotero.debug("ZoteroAutoTagger: pane elements not ready, setting up MutationObserver");
  const observer = new MutationObserver(() => {
    if (initPane()) {
      observer.disconnect();
    }
  });
  observer.observe(document, { childList: true, subtree: true });
}
