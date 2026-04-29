/**
 * AutoTagger — core tagging pipeline.
 *
 * Registers a Zotero Notifier observer that fires on every item-add event.
 * For each new regular item (journal article, preprint, book chapter, etc.)
 * it runs a two-stage tagging pipeline:
 *   1. If the item is an arXiv preprint, fetch its subject categories from
 *      the arXiv Atom API and translate them to human-readable tags.
 *   2. Call the Claude API with the title, abstract, and any arXiv tags
 *      already assigned, and receive a broad domain tag plus 5–8 specific
 *      content tags.
 *
 * All generated tags are written back with type 1 (automatic), which
 * distinguishes them from user-applied tags (type 0) in Zotero's UI.
 * Tags are always appended — existing tags on the item are never removed.
 */

const PREF_API_KEY = "extensions.zotero-autotagger.apiKey";
const CLAUDE_MODEL = "claude-sonnet-4-6";
const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";

/**
 * Manages the Zotero Notifier subscription and drives the tagging pipeline.
 *
 * @param {null} _notifierID - Notifier handle, set on init() and cleared on shutdown().
 */
class AutoTagger {
  constructor() {
    this._notifierID = null;
  }

  /**
   * Register the Notifier observer and begin listening for item-add events.
   *
   * The third argument ("autotagger") is a debug label shown in Zotero's
   * notifier logs and must be unique across all registered observers.
   *
   * @returns {void}
   */
  init() {
    this._notifierID = Zotero.Notifier.registerObserver(this, ["item"], "autotagger");
    Zotero.log("ZoteroAutoTagger: started");
  }

  /**
   * Unregister the Notifier observer and stop listening for events.
   *
   * Must be called on plugin shutdown to avoid a dangling observer.
   *
   * @returns {void}
   */
  shutdown() {
    if (this._notifierID) {
      Zotero.Notifier.unregisterObserver(this._notifierID);
      this._notifierID = null;
    }
    Zotero.log("ZoteroAutoTagger: stopped");
  }

  /**
   * Handle a batch of Zotero Notifier events.
   *
   * Zotero delivers events in batches — multiple items can be added in a
   * single notification (e.g. when importing a BibTeX file). Each item is
   * processed sequentially to avoid hammering the Claude API with concurrent
   * requests. Attachments, notes, and annotations are skipped because they
   * are not independently citable items.
   *
   * @param {string} event - Notifier event type (e.g. "add", "modify", "delete").
   * @param {string} type - Object type (e.g. "item", "collection", "library").
   * @param {number[]} ids - Array of Zotero item IDs affected by the event.
   * @param {object} _extraData - Additional event metadata (unused).
   * @returns {Promise<void>}
   */
  async notify(event, type, ids, _extraData) {
    if (event !== "add" || type !== "item") return;
    for (const id of ids) {
      const item = Zotero.Items.get(id);
      if (!item || !item.isRegularItem()) continue;
      await this._tagItem(item);
    }
  }

  /**
   * Run the full tagging pipeline for a single item.
   *
   * Tag ordering is intentional: arXiv tags come first because they are
   * deterministic (no LLM involved), followed by the broad domain tag from
   * Claude (placed at the front via unshift), then the specific content tags.
   * This ordering is reflected in Zotero's tag panel when tags are sorted
   * by date added.
   *
   * item.saveTx() (not item.save()) is required because Zotero's DB write
   * path uses SQLite transactions; the Tx variant commits atomically.
   *
   * @param {Zotero.Item} item - A Zotero regular item (not an attachment or note).
   * @returns {Promise<void>}
   */
  async _tagItem(item) {
    const apiKey = Zotero.Prefs.get(PREF_API_KEY, true);
    if (!apiKey) {
      Zotero.log(
        "ZoteroAutoTagger: API key not set — open Zotero Preferences → AutoTagger",
        "warning"
      );
      return;
    }

    const title = item.getField("title") || "";
    const abstract = item.getField("abstractNote") || "";
    if (!title) return;

    const newTags = [];

    // arXiv tags are fetched first so Claude can see the subject area context
    // and avoid generating duplicate tags.
    const arxivID = this._getArxivID(item);
    if (arxivID) {
      const arxivTags = await ArxivHelper.fetchSubjectTags(arxivID);
      newTags.push(...arxivTags);
    }

    try {
      const { domain, tags } = await this._callClaude(apiKey, title, abstract, newTags);
      newTags.unshift(domain); // domain tag goes first in the final list
      newTags.push(...tags);
    } catch (e) {
      Zotero.log(`ZoteroAutoTagger: Claude error for "${title}": ${e.message}`, "error");
    }

    for (const tag of newTags) {
      item.addTag(tag, 1); // type 1 = automatic tag (vs. type 0 = manual)
    }
    if (newTags.length) {
      await item.saveTx();
      Zotero.log(`ZoteroAutoTagger: tagged "${title}" → [${newTags.join(", ")}]`);
    }
  }

  /**
   * Extract a bare arXiv identifier from a Zotero item's fields.
   *
   * Two sources are checked because Zotero's Chrome connector is inconsistent:
   * for arXiv papers saved via the browser extension the URL field is usually
   * populated, but for items imported from BibTeX or DOI lookup the arXiv ID
   * often ends up only in the "extra" field as "arXiv: XXXX.XXXXX".
   *
   * Version suffixes (e.g. "v2" in "2301.12345v2") are intentionally stripped
   * by the capture group — the arXiv API always returns the latest version's
   * metadata when queried by bare ID.
   *
   * @param {Zotero.Item} item - The Zotero item to inspect.
   * @returns {string|null} Bare arXiv ID (e.g. "2301.12345"), or null if not an arXiv item.
   */
  _getArxivID(item) {
    const url = item.getField("url") || "";
    const urlMatch = url.match(/arxiv\.org\/(?:abs|pdf)\/([0-9]{4}\.[0-9]+)/);
    if (urlMatch) return urlMatch[1];

    // Zotero often stores "arXiv: 2301.12345" in the extra field
    const extra = item.getField("extra") || "";
    const extraMatch = extra.match(/arXiv:\s*([0-9]{4}\.[0-9]+)/i);
    if (extraMatch) return extraMatch[1];

    return null;
  }

  /**
   * Call the Claude API to generate a broad domain tag and specific content tags.
   *
   * The prompt passes any already-assigned arXiv tags so Claude can avoid
   * duplicating subject-area concepts. The response is expected to be a JSON
   * object; markdown code fences are stripped defensively because Claude
   * occasionally wraps JSON in ```json blocks despite the prompt instruction.
   *
   * @param {string} apiKey - Anthropic API key from Zotero preferences.
   * @param {string} title - Paper title.
   * @param {string} abstract - Paper abstract, or empty string if unavailable.
   * @param {string[]} existingTags - Tags already assigned (from arXiv), to avoid duplication.
   * @returns {Promise<{domain: string, tags: string[]}>} Parsed Claude response.
   * @throws {Error} If the HTTP request fails or the response body is not valid JSON.
   */
  async _callClaude(apiKey, title, abstract, existingTags) {
    const existingNote = existingTags.length
      ? `\nSubject tags already assigned (from arXiv): [${existingTags.join(", ")}] — do not repeat these.`
      : "";

    const prompt = [
      "You are a research librarian. Given a paper's title and abstract, return:",
      "1. A single broad domain tag (e.g. 'machine-learning', 'structural-biology', 'cosmology', 'economics')",
      "2. 5–8 specific content tags for the paper's topic, findings, and methods",
      "",
      "Tag rules: lowercase, hyphenated-if-multi-word, specific and useful for filtering a personal research library.",
      "Do not use generic terms like 'research', 'study', or 'paper'.",
      existingNote,
      "",
      `Title: ${title}`,
      `Abstract: ${abstract || "(not available)"}`,
      "",
      'Respond with ONLY a JSON object: {"domain": "...", "tags": [...]}',
    ]
      .filter(line => line !== undefined)
      .join("\n");

    const response = await fetch(CLAUDE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    const text = data.content[0].text
      .trim()
      .replace(/^```(?:json)?\n?/, "")
      .replace(/\n?```$/, "");
    return JSON.parse(text);
  }
}
