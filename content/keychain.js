/**
 * KeychainHelper — secure credential storage via Firefox's login manager.
 *
 * Zotero is built on Firefox and inherits its nsILoginManager, which stores
 * credentials in an AES-256 encrypted file (key4.db / logins.json in the
 * Zotero profile). On macOS, the decryption master key is protected by the
 * system Keychain, so the API key is effectively Keychain-backed at rest.
 *
 * This is the standard credential storage mechanism for Zotero plugins —
 * the same path Zotero itself uses for its cloud storage API key. The entry
 * is not visible as a named item in Keychain Access; it lives inside
 * Zotero's encrypted credential store.
 *
 * The login manager identifies entries by (hostname, httpRealm) tuple.
 * We use a chrome:// URI as the hostname to namespace the entry away from
 * any real web credentials.
 */

const KEYCHAIN_HOST  = "chrome://zotero-autotagger";
const KEYCHAIN_REALM = "Anthropic API Key";
const KEYCHAIN_USER  = "anthropic";

const KeychainHelper = {
  /**
   * Read the stored Anthropic API key.
   *
   * Returns null rather than throwing if the credential does not exist yet
   * or if the login manager is unavailable, so callers can treat a missing
   * key as "not configured" without try/catch boilerplate.
   *
   * @returns {string|null} The stored API key, or null if not set.
   */
  get() {
    try {
      const logins = Services.logins.findLogins(KEYCHAIN_HOST, null, KEYCHAIN_REALM);
      return logins.length ? logins[0].password : null;
    } catch (e) {
      Zotero.debug(`ZoteroAutoTagger: keychain read failed: ${e.message}`, "warning");
      return null;
    }
  },

  /**
   * Store or update the Anthropic API key.
   *
   * Uses modifyLogin when an entry already exists so that only one credential
   * is ever stored for this plugin. addLogin would create a duplicate entry
   * if called twice, which findLogins would then return as an array of two.
   *
   * @param {string} apiKey - The Anthropic API key to store.
   * @returns {void}
   */
  set(apiKey) {
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
      Zotero.debug(`ZoteroAutoTagger: keychain write failed: ${e.message}`, "error");
    }
  },

  /**
   * Remove the stored credential, e.g. when the user clears the API key field.
   *
   * @returns {void}
   */
  remove() {
    try {
      const existing = Services.logins.findLogins(KEYCHAIN_HOST, null, KEYCHAIN_REALM);
      for (const login of existing) {
        Services.logins.removeLogin(login);
      }
    } catch (e) {
      Zotero.debug(`ZoteroAutoTagger: keychain remove failed: ${e.message}`, "warning");
    }
  },
};
