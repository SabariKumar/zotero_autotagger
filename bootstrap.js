var ZoteroAutoTagger;

function startup({ rootURI }) {
  Services.scriptloader.loadSubScript(rootURI + "content/autotagger.js");
  ZoteroAutoTagger = new AutoTagger();
  ZoteroAutoTagger.init();
}

function shutdown() {
  ZoteroAutoTagger?.shutdown();
  ZoteroAutoTagger = undefined;
}

function install() {}
function uninstall() {}
