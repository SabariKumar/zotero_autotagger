const PREF_API_KEY = "extensions.zotero-autotagger.apiKey";
const CLAUDE_MODEL = "claude-sonnet-4-6";
const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";

class AutoTagger {
  constructor() {
    this._notifierID = null;
  }

  init() {
    this._notifierID = Zotero.Notifier.registerObserver(this, ["item"], "autotagger");
    Zotero.log("ZoteroAutoTagger: started");
  }

  shutdown() {
    if (this._notifierID) {
      Zotero.Notifier.unregisterObserver(this._notifierID);
      this._notifierID = null;
    }
    Zotero.log("ZoteroAutoTagger: stopped");
  }

  async notify(event, type, ids, _extraData) {
    if (event !== "add" || type !== "item") return;
    for (const id of ids) {
      const item = Zotero.Items.get(id);
      if (!item || !item.isRegularItem()) continue;
      await this._tagItem(item);
    }
  }

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

    // arXiv subject tags are fetched first so Claude can see the subject area context
    const arxivID = this._getArxivID(item);
    if (arxivID) {
      const arxivTags = await ArxivHelper.fetchSubjectTags(arxivID);
      newTags.push(...arxivTags);
    }

    try {
      const { domain, tags } = await this._callClaude(apiKey, title, abstract, newTags);
      newTags.unshift(domain); // domain tag goes first
      newTags.push(...tags);
    } catch (e) {
      Zotero.log(`ZoteroAutoTagger: Claude error for "${title}": ${e.message}`, "error");
    }

    for (const tag of newTags) {
      item.addTag(tag, 1); // type 1 = automatic tag
    }
    if (newTags.length) {
      await item.saveTx();
      Zotero.log(`ZoteroAutoTagger: tagged "${title}" → [${newTags.join(", ")}]`);
    }
  }

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
