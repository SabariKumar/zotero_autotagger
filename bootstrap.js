var ZoteroAutoTagger;
var _prefPaneID;

function startup({ rootURI }) {
  Services.scriptloader.loadSubScript(rootURI + "content/arxiv.js");
  Services.scriptloader.loadSubScript(rootURI + "content/autotagger.js");
  ZoteroAutoTagger = new AutoTagger();
  ZoteroAutoTagger.init();

  _prefPaneID = Zotero.PreferencePanes.register({
    pluginID: "zotero-autotagger@sabarinkumar",
    src: rootURI + "prefs/prefs.xhtml",
    label: "AutoTagger",
  });
}

function shutdown() {
  ZoteroAutoTagger?.shutdown();
  ZoteroAutoTagger = undefined;

  if (_prefPaneID) {
    Zotero.PreferencePanes.unregister(_prefPaneID);
    _prefPaneID = undefined;
  }
}

function install() {}
function uninstall() {}
