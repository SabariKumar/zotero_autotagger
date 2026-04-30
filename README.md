# Zotero AutoTagger

A Zotero 7 plugin that automatically tags papers with content-based tags when they are added to your library — via the browser connector, DOI lookup, or any other import method.

---

## Purpose

Zotero's tagging system is only useful if tags are applied consistently. Doing this by hand is slow and rarely happens at the moment a paper is added. This plugin hooks into Zotero's internal event system and runs a two-stage tagging pipeline the moment a new item lands in your library: first pulling structured subject tags from arXiv's taxonomy (for preprints), then calling Claude to assign a broad domain tag and 5–12 specific content tags derived from the title and abstract.

---

## Module contents

### `bootstrap.js`

The Bootstrap plugin entry point required by Zotero 7's extension API. Zotero 7 replaced the older XUL overlay system with a Bootstrap model in which the plugin supplies four lifecycle functions (`startup`, `shutdown`, `install`, `uninstall`). This file handles loading the content scripts, starting the `AutoTagger` instance, and registering the preferences pane.

Content scripts cannot use ES module `import` statements in Zotero's chrome environment; instead they are loaded via `Services.scriptloader.loadSubScript`, which evaluates each file into the bootstrap's global scope. `arxiv.js` is loaded before `autotagger.js` because `AutoTagger` references the `ArxivHelper` global defined in `arxiv.js`.

### `content/autotagger.js`

Defines the `AutoTagger` class, which owns the Zotero Notifier subscription and drives the tagging pipeline.

**Notifier pattern.** `AutoTagger` implements the Notifier observer interface by exposing a `notify(event, type, ids, extraData)` method. Zotero calls this method for every library event; the class filters for `event === "add"` and `type === "item"`. Attachments, notes, and annotations are skipped via `item.isRegularItem()` because they are not independently citable.

**Item type correction.** Before tagging, the plugin checks whether a newly added item is a `webpage` with an arxiv.org URL. This happens when a paper is saved from the arXiv PDF viewer rather than the abstract page, which causes Zotero's translator to miss the paper and fall back to a generic webpage save. The plugin promotes such items to `preprint` automatically, preserving all common fields (title, URL, date, abstract).

**Tagging pipeline.** For each new regular item:
1. Check whether the item is an arXiv preprint by inspecting the `url` field (primary) and the `extra` field (fallback). If it is, call `ArxivHelper.fetchSubjectTags` and collect the translated category tags.
2. Call the Claude API with the title, abstract, and any arXiv tags already collected. Claude returns a JSON object `{"domain": "...", "tags": [...]}`. The `domain` tag is prepended so it appears first in Zotero's tag panel.
3. Write all tags back to the item with `item.addTag(tag, 1)` (type 1 = automatic) and persist with `item.saveTx()`.

Tags are always appended — the plugin never removes or replaces existing tags.

### `content/keychain.js`

Defines the `KeychainHelper` singleton, which wraps Firefox's `nsILoginManager` (`Services.logins`) for secure credential storage. Credentials are stored under the key `(chrome://zotero-autotagger, "Anthropic API Key")` and encrypted with AES-256; on macOS the decryption master key is protected by the system Keychain. `set()` uses `modifyLogin` when an entry already exists to avoid creating duplicate credentials. `get()` and `remove()` return gracefully on failure rather than throwing, so a missing or inaccessible credential is treated as "not configured".

The prefs pane cannot import this module (separate document scope), so its login manager calls are inlined verbatim — keep the `KEYCHAIN_HOST`, `KEYCHAIN_REALM`, and `KEYCHAIN_USER` constants in sync if they ever change.

### `content/arxiv.js`

Defines the `ArxivHelper` singleton object and the `ARXIV_CATEGORIES` lookup table.

`ArxivHelper.fetchSubjectTags` queries `https://export.arxiv.org/api/query?id_list={id}`, which returns an Atom XML feed. The feed is parsed with `DOMParser` (available in Zotero's Firefox-derived runtime). Each `<category term="...">` element is extracted and looked up in `ARXIV_CATEGORIES`; codes not in the table fall back to a mechanical conversion (`cs.LG` → `cs-lg`) so no category is silently dropped. Failures are non-fatal — a warning is logged and the Claude stage continues.

### `prefs/prefs.xhtml`

An XHTML preferences pane registered with `Zotero.PreferencePanes`. Provides a password-type input for the Anthropic API key and a **Tag All Library Items** button for bulk-tagging existing items. The key is stored via Firefox's `nsILoginManager` (see `content/keychain.js`) and read at tagging time so changes take effect immediately without restarting Zotero.

### `prefs/prefs.js`

JavaScript for the preferences pane, loaded as a separate file via the `scripts: [...]` parameter of `Zotero.PreferencePanes.register`. It uses a `MutationObserver` to initialise only once the pane's DOM elements are actually injected into the preferences window (see **Zotero 7 pref pane gotchas** below).

---

## Data contracts

### Input — new Zotero item

The plugin reads the following fields from each newly added `Zotero.Item`:

| Field | Zotero key | Used for |
|---|---|---|
| Item type | `itemTypeID` | Detected if `webpage`; promoted to `preprint` if URL matches arxiv.org |
| Title | `title` | Required for tagging — items without a title are skipped |
| Abstract | `abstractNote` | Passed to Claude; tagging proceeds if absent |
| URL | `url` | arXiv ID extraction (primary source) and webpage type detection |
| Extra | `extra` | arXiv ID extraction (fallback, pattern: `arXiv: XXXX.XXXXX`) |

### Output — tags written to item

| Tag | Type | Source | Example |
|---|---|---|---|
| arXiv subject tags | automatic (1) | arXiv Atom API | `machine-learning`, `computer-vision` |
| Broad domain tag | automatic (1) | Claude | `structural-biology` |
| Content tags (5–12) | automatic (1) | Claude | `protein-folding`, `diffusion-model` |

Tags use lowercase, hyphenated-if-multi-word formatting throughout.

### Claude API — request/response

**Request body** (Anthropic Messages API):
```json
{
  "model": "claude-haiku-4-5-20251001",
  "max_tokens": 512,
  "messages": [{ "role": "user", "content": "<prompt>" }]
}
```

**Expected response content** (parsed from `data.content[0].text`):
```json
{ "domain": "machine-learning", "tags": ["transformer", "protein-structure", "attention-mechanism"] }
```

Markdown code fences are stripped defensively before parsing, as Claude occasionally wraps JSON in ` ```json ` blocks despite the prompt instruction.

---

## Critical parameters and constraints

**`CLAUDE_MODEL`** (`content/autotagger.js`): Pinned to `claude-haiku-4-5-20251001`. Haiku is sufficient for this task — structured JSON extraction from a title and abstract requires no complex reasoning. Update this constant when migrating to a newer model.

**`max_tokens: 512`**: Sized for a domain tag + up to 12 content tags as JSON. A truncated response will fail JSON parsing and log a Claude error for the item — increase this value if you raise the tag limit further.

**`item.addTag(tag, 1)`**: The second argument `1` marks tags as automatic. Zotero's tag selector can filter by type; automatic tags appear under a separate "Automatic" section. Using `0` (or omitting the argument) would mark tags as manual, making them indistinguishable from user-applied tags.

**`item.saveTx()`**: Zotero requires the `Tx` (transactional) variant for DB persistence. Calling `item.save()` alone is not sufficient and will appear to succeed but not commit.

**Abstract truncation** (`content/autotagger.js`): The abstract is capped at 2 000 characters before being included in the Claude prompt. Some papers (especially in biology and medicine) have very long abstracts that would otherwise exceed the API's prompt length limit and return a `400` error. 2 000 characters comfortably covers any real abstract while staying well under the limit.

**API key storage** (`content/keychain.js`): The Anthropic API key is stored in Firefox's `nsILoginManager` rather than Zotero's plain-text preference store. On macOS this is backed by the system Keychain. The prefs pane inlines its own login manager calls because it runs in a separate document scope that cannot access the `KeychainHelper` global defined in the bootstrap.

**arXiv ID version stripping**: The URL regex `[0-9]{4}\.[0-9]+` stops at the `v` in version suffixes like `2301.12345v2`, yielding the bare ID. The arXiv API always returns the latest metadata for a bare ID, so this is the correct behaviour.

---

## Zotero 7 pref pane gotchas

These bit us during development and are not clearly documented anywhere.

### Inline `<script>` tags are silently ignored

Zotero 7's `PreferencePanes` system does not execute `<script>` tags embedded in the pane's XHTML. The script runs in no context and produces no error — it is simply dropped. All JavaScript must be in a separate `.js` file registered via the `scripts: [...]` array in `Zotero.PreferencePanes.register`:

```js
_prefPaneID = await Zotero.PreferencePanes.register({
  pluginID: "zotero-autotagger@sabarinkumar",
  src: rootURI + "prefs/prefs.xhtml",
  scripts: [rootURI + "prefs/prefs.js"],   // ← required
  label: "AutoTagger",
});
```

### `PreferencePanes.register` returns a Promise — await it

`register()` is async. Not awaiting it means `_prefPaneID` receives a `Promise` object rather than the pane ID string. The pane still registers (the Promise resolves in the background), but `shutdown` cannot unregister it correctly. The symptom in the debug log is `prefPaneID=[object Promise]`.

### Pref pane HTML is injected lazily — `window.load` is too early

Scripts loaded via `scripts: []` execute when the preferences window opens, which is before the user has navigated to your specific pane. At that point `document.getElementById("autotagger-bulk-btn")` returns `null` because your XHTML fragment has not yet been inserted. Wrapping initialization in `window.addEventListener("load", ...)` does not help for the same reason: the preferences window's `load` event also fires before any pane fragment is injected.

The correct pattern is a `MutationObserver` that watches for your elements to appear:

```js
function initPane() {
  const bulkBtn = document.getElementById("autotagger-bulk-btn");
  if (!bulkBtn) return false;
  // attach listeners...
  return true;
}

if (!initPane()) {
  const observer = new MutationObserver(() => {
    if (initPane()) observer.disconnect();
  });
  observer.observe(document, { childList: true, subtree: true });
}
```

---

## Dependencies

**Runtime**: Zotero ≥ 7.0 (strictly — the Bootstrap API and `Zotero.PreferencePanes` are not available in Zotero 6).

**External APIs**:
- `https://api.anthropic.com/v1/messages` — requires an Anthropic API key set in Preferences → AutoTagger.
- `https://export.arxiv.org/api/query` — public, no authentication. Called only for items detected as arXiv preprints.

**No npm dependencies.** The plugin is plain JavaScript with no build step. The `.xpi` is produced by `./build.sh`, which zips `manifest.json`, `bootstrap.js`, and the `content/` and `prefs/` directories.

---

## Installation

```sh
# Build the plugin
./build.sh

# In Zotero: Tools → Add-ons → gear icon → Install Add-on From File
# Select: zotero-autotagger.xpi

# Set your API key: Zotero → Preferences → AutoTagger
# Alternatively, Zotero → Developer → Run Javascript:
const li = Cc["@mozilla.org/login-manager/loginInfo;1"].createInstance(Ci.nsILoginInfo);
li.init("chrome://zotero-autotagger", null, "Anthropic API Key", "anthropic", "sk-ant-YOUR-KEY-HERE", "", "");
Services.logins.addLogin(li);

# To update a stored key:
const HOST = "chrome://zotero-autotagger";
const REALM = "Anthropic API Key";
const existing = Services.logins.findLogins(HOST, null, REALM);
const li = Cc["@mozilla.org/login-manager/loginInfo;1"].createInstance(Ci.nsILoginInfo);
li.init(HOST, null, REALM, "anthropic", "sk-ant-YOUR-KEY-HERE", "", "");
Services.logins.modifyLogin(existing[0], li);

# To view the stored key:
const logins = Services.logins.findLogins("chrome://zotero-autotagger", null, "Anthropic API Key");
logins[0].password;
```

To verify the plugin is running, open **Help → Debug Output Logging → View Output** and look for `ZoteroAutoTagger: started`. Each tagging event logs `ZoteroAutoTagger: tagged "<title>" → [tag1, tag2, ...]`.

---
Dedicated to Will Hughes' citation spreadsheets.
