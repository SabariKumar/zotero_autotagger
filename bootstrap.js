/**
 * Zotero AutoTagger — Bootstrap entry point.
 *
 * Zotero 7 uses the Bootstrap plugin API instead of the older XUL overlay system.
 * This file must export exactly four lifecycle functions: startup, shutdown,
 * install, and uninstall. Zotero calls them on the corresponding plugin events.
 *
 * Content scripts cannot use ES module imports in Zotero's chrome environment,
 * so dependencies are loaded via Services.scriptloader.loadSubScript, which
 * evaluates each file into the bootstrap's global scope in load order.
 * Load order: keychain.js → arxiv.js → autotagger.js (each depends on the prior).
 */

var ZoteroAutoTagger;
var _prefPaneID;

/**
 * Initialise the plugin after Zotero is fully loaded.
 *
 * Loads content scripts into the global scope, starts the AutoTagger notifier,
 * and registers the preferences pane. arxiv.js must be loaded before
 * autotagger.js because AutoTagger's _tagItem method references ArxivHelper.
 *
 * @param {object} options
 * @param {string} options.rootURI - Resource URI of the plugin's root directory,
 *   e.g. "resource://zotero-autotagger/". Used to construct absolute paths for
 *   subscript loading and the preferences pane src.
 * @returns {void}
 */
async function startup({ rootURI }) {
  await Zotero.initializationPromise;
  try {
    Services.scriptloader.loadSubScript(rootURI + "content/keychain.js");
    Services.scriptloader.loadSubScript(rootURI + "content/arxiv.js");
    Services.scriptloader.loadSubScript(rootURI + "content/autotagger.js");
    ZoteroAutoTagger = new AutoTagger();
    ZoteroAutoTagger.init();
    Zotero.AutoTagger = ZoteroAutoTagger;

    _prefPaneID = await Zotero.PreferencePanes.register({
      pluginID: "zotero-autotagger@sabarinkumar",
      src: rootURI + "prefs/prefs.xhtml",
      scripts: [rootURI + "prefs/prefs.js"],
      label: "AutoTagger",
    });
    Zotero.debug("ZoteroAutoTagger: started, prefPaneID=" + _prefPaneID);
  } catch (e) {
    Zotero.debug("ZoteroAutoTagger: startup FAILED — " + e + "\n" + (e.stack || "no stack"), 1);
  }
}

/**
 * Tear down the plugin when it is disabled or Zotero quits.
 *
 * Unregistering the Notifier observer is mandatory — failing to do so leaves
 * a dangling observer that fires on item events even after the plugin is
 * disabled, causing errors because AutoTagger's methods no longer exist.
 *
 * @returns {void}
 */
function shutdown() {
  ZoteroAutoTagger?.shutdown();
  ZoteroAutoTagger = undefined;
  delete Zotero.AutoTagger;

  if (_prefPaneID) {
    Zotero.PreferencePanes.unregister(_prefPaneID);
    _prefPaneID = undefined;
  }
}

/**
 * Called once when the plugin is first installed. No setup required.
 *
 * @returns {void}
 */
function install() {}

/**
 * Called when the plugin is uninstalled. No cleanup required beyond shutdown.
 *
 * @returns {void}
 */
function uninstall() {}
