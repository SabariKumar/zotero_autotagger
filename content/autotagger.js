const PREF_API_KEY = "extensions.zotero-autotagger.apiKey";
const CLAUDE_MODEL = "claude-sonnet-4-6";
const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";

class AutoTagger {
  constructor() {
    this._notifierID = null;
  }

  init() {
    this._notifierID = Zotero.Notifier.registerObserver(
      this,
      ["item"],
      "autotagger"
    );
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
      // Skip attachments, notes, annotations
      if (!item || !item.isRegularItem()) continue;
      await this._tagItem(item);
    }
  }

  async _tagItem(item) {
    const apiKey = Zotero.Prefs.get(PREF_API_KEY, true);
    if (!apiKey) {
      Zotero.log("ZoteroAutoTagger: API key not set. Set it with Zotero.Prefs.set('" + PREF_API_KEY + "', 'sk-ant-...')", "warning");
      return;
    }

    const title = item.getField("title") || "";
    const abstract = item.getField("abstractNote") || "";
    if (!title) return;

    try {
      const tags = await this._callClaude(apiKey, title, abstract);
      if (!tags.length) return;

      for (const tag of tags) {
        item.addTag(tag, 1); // tag type 1 = automatic
      }
      await item.saveTx();
      Zotero.log(`ZoteroAutoTagger: tagged "${title}" → [${tags.join(", ")}]`);
    } catch (e) {
      Zotero.log(`ZoteroAutoTagger: failed to tag "${title}": ${e.message}`, "error");
    }
  }

  async _callClaude(apiKey, title, abstract) {
    const prompt = [
      "You are a research librarian. Given a paper's title and abstract, generate 5–8 concise content tags.",
      "Tags should be lowercase, hyphenated if multi-word, and specific enough to be useful for filtering a personal research library.",
      "Focus on topic, domain, and methods — not generic terms like 'research' or 'paper'.",
      "",
      `Title: ${title}`,
      `Abstract: ${abstract || "(not available)"}`,
      "",
      "Respond with ONLY a JSON array of tag strings. Example: [\"protein-folding\", \"transformer\", \"cryo-em\"]",
    ].join("\n");

    const response = await fetch(CLAUDE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 256,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`HTTP ${response.status}: ${err}`);
    }

    const data = await response.json();
    const text = data.content[0].text.trim();

    // Strip markdown code fences if Claude wraps the JSON
    const cleaned = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    return JSON.parse(cleaned);
  }
}
