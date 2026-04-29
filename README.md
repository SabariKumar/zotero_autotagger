# Zotero AutoTagger

A Zotero 7 plugin that automatically tags papers with content-based tags when they are added to your library — via the browser connector, DOI lookup, or any other import method.

---

## Purpose

Zotero's tagging system is only useful if tags are applied consistently. Doing this by hand is slow and rarely happens at the moment a paper is added. This plugin hooks into Zotero's internal event system and runs a two-stage tagging pipeline the moment a new item lands in your library: first pulling structured subject tags from arXiv's taxonomy (for preprints), then calling Claude to assign a broad domain tag and 5–8 specific content tags derived from the title and abstract.

---

## Module contents

### `bootstrap.js`

The Bootstrap plugin entry point required by Zotero 7's extension API. Zotero 7 replaced the older XUL overlay system with a Bootstrap model in which the plugin supplies four lifecycle functions (`startup`, `shutdown`, `install`, `uninstall`). This file handles loading the content scripts, starting the `AutoTagger` instance, and registering the preferences pane.

Content scripts cannot use ES module `import` statements in Zotero's chrome environment; instead they are loaded via `Services.scriptloader.loadSubScript`, which evaluates each file into the bootstrap's global scope. `arxiv.js` is loaded before `autotagger.js` because `AutoTagger` references the `ArxivHelper` global defined in `arxiv.js`.

### `content/autotagger.js`

Defines the `AutoTagger` class, which owns the Zotero Notifier subscription and drives the tagging pipeline.

**Notifier pattern.** `AutoTagger` implements the Notifier observer interface by exposing a `notify(event, type, ids, extraData)` method. Zotero calls this method for every library event; the class filters for `event === "add"` and `type === "item"`. Attachments, notes, and annotations are skipped via `item.isRegularItem()` because they are not independently citable.

**Tagging pipeline.** For each new regular item:
1. Check whether the item is an arXiv preprint by inspecting the `url` field (primary) and the `extra` field (fallback). If it is, call `ArxivHelper.fetchSubjectTags` and collect the translated category tags.
2. Call the Claude API with the title, abstract, and any arXiv tags already collected. Claude returns a JSON object `{"domain": "...", "tags": [...]}`. The `domain` tag is prepended so it appears first in Zotero's tag panel.
3. Write all tags back to the item with `item.addTag(tag, 1)` (type 1 = automatic) and persist with `item.saveTx()`.

Tags are always appended — the plugin never removes or replaces existing tags.

### `content/arxiv.js`

Defines the `ArxivHelper` singleton object and the `ARXIV_CATEGORIES` lookup table.

`ArxivHelper.fetchSubjectTags` queries `https://export.arxiv.org/api/query?id_list={id}`, which returns an Atom XML feed. The feed is parsed with `DOMParser` (available in Zotero's Firefox-derived runtime). Each `<category term="...">` element is extracted and looked up in `ARXIV_CATEGORIES`; codes not in the table fall back to a mechanical conversion (`cs.LG` → `cs-lg`) so no category is silently dropped. Failures are non-fatal — a warning is logged and the Claude stage continues.

### `prefs/prefs.xhtml`

An XHTML preferences pane registered with `Zotero.PreferencePanes`. Provides a password-type input for the Anthropic API key. The key is stored in Zotero's global preference store under `extensions.zotero-autotagger.apiKey` and is read at tagging time (not cached) so changes take effect immediately without restarting Zotero.

---

## Data contracts

### Input — new Zotero item

The plugin reads the following fields from each newly added `Zotero.Item`:

| Field | Zotero key | Used for |
|---|---|---|
| Title | `title` | Required — items without a title are skipped |
| Abstract | `abstractNote` | Passed to Claude; tagging proceeds if absent |
| URL | `url` | arXiv ID extraction (primary source) |
| Extra | `extra` | arXiv ID extraction (fallback, pattern: `arXiv: XXXX.XXXXX`) |

### Output — tags written to item

| Tag | Type | Source | Example |
|---|---|---|---|
| arXiv subject tags | automatic (1) | arXiv Atom API | `machine-learning`, `computer-vision` |
| Broad domain tag | automatic (1) | Claude | `structural-biology` |
| Content tags (5–8) | automatic (1) | Claude | `protein-folding`, `diffusion-model` |

Tags use lowercase, hyphenated-if-multi-word formatting throughout.

### Claude API — request/response

**Request body** (Anthropic Messages API):
```json
{
  "model": "claude-sonnet-4-6",
  "max_tokens": 300,
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

**`CLAUDE_MODEL`** (`content/autotagger.js`): Pinned to `claude-sonnet-4-6`. Update this constant when migrating to a newer model; the prompt format is stable across Sonnet versions.

**`max_tokens: 300`**: Sufficient for a domain tag + 8 content tags as JSON. If you extend the prompt to request more tags, increase this value — a truncated response will fail JSON parsing and log a Claude error for the item.

**`item.addTag(tag, 1)`**: The second argument `1` marks tags as automatic. Zotero's tag selector can filter by type; automatic tags appear under a separate "Automatic" section. Using `0` (or omitting the argument) would mark tags as manual, making them indistinguishable from user-applied tags.

**`item.saveTx()`**: Zotero requires the `Tx` (transactional) variant for DB persistence. Calling `item.save()` alone is not sufficient and will appear to succeed but not commit.

**`Zotero.Prefs.get(key, true)`**: The second argument `true` requests the global preference scope. Without it, Zotero may look up the key in a per-library scope and return `undefined` even when the key is set.

**arXiv ID version stripping**: The URL regex `[0-9]{4}\.[0-9]+` stops at the `v` in version suffixes like `2301.12345v2`, yielding the bare ID. The arXiv API always returns the latest metadata for a bare ID, so this is the correct behaviour.

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
```

To verify the plugin is running, open **Help → Debug Output Logging → View Output** and look for `ZoteroAutoTagger: started`. Each tagging event logs `ZoteroAutoTagger: tagged "<title>" → [tag1, tag2, ...]`.
