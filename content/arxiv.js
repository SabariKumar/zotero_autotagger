/**
 * ArxivHelper — arXiv subject tag fetcher.
 *
 * Queries the arXiv Atom API for a paper's registered subject categories and
 * translates them to human-readable hyphenated tag strings. Categories that
 * are not in the ARXIV_CATEGORIES map are converted by a mechanical fallback
 * (e.g. "cs.LG" → "cs-lg") so no category is silently dropped.
 *
 * The Atom feed is parsed with DOMParser, which is available in Zotero's
 * Firefox-derived environment without any imports.
 */

var ARXIV_API = "https://export.arxiv.org/api/query?id_list=";

/**
 * Maps arXiv category codes to human-readable hyphenated tag strings.
 *
 * Only the most common subcategories are listed. Unmapped codes are handled
 * by ArxivHelper._codeToTag. Add entries here to improve tag quality for
 * fields not yet covered.
 *
 * @type {Object.<string, string>}
 */
var ARXIV_CATEGORIES = {
  // Computer Science
  "cs.AI":  "artificial-intelligence",
  "cs.CL":  "computational-linguistics",
  "cs.CV":  "computer-vision",
  "cs.LG":  "machine-learning",
  "cs.NE":  "neural-networks",
  "cs.RO":  "robotics",
  "cs.CR":  "cryptography-security",
  "cs.DS":  "algorithms-data-structures",
  "cs.GT":  "game-theory",
  "cs.IR":  "information-retrieval",
  "cs.SI":  "social-networks",
  "cs.HC":  "human-computer-interaction",
  "cs.DB":  "databases",
  "cs.DC":  "distributed-computing",
  "cs.PL":  "programming-languages",
  "cs.AR":  "computer-architecture",
  "cs.SE":  "software-engineering",
  "cs.GR":  "computer-graphics",
  "cs.MA":  "multi-agent-systems",
  "cs.NA":  "numerical-analysis",
  // Statistics
  "stat.ML": "statistical-machine-learning",
  "stat.ME": "statistical-methodology",
  "stat.TH": "statistical-theory",
  "stat.AP": "applied-statistics",
  "stat.CO": "computational-statistics",
  // Mathematics
  "math.ST": "statistics-theory",
  "math.OC": "optimization-control",
  "math.PR": "probability",
  "math.CO": "combinatorics",
  "math.NA": "numerical-analysis",
  "math.LO": "logic",
  "math.IT": "information-theory",
  // Quantitative Biology
  "q-bio.BM": "biomolecules",
  "q-bio.CB": "cell-biology",
  "q-bio.GN": "genomics",
  "q-bio.MN": "molecular-networks",
  "q-bio.NC": "computational-neuroscience",
  "q-bio.PE": "population-genetics",
  "q-bio.QM": "quantitative-biology-methods",
  "q-bio.SC": "subcellular-processes",
  "q-bio.TO": "tissues-organs",
  // Physics
  "physics.bio-ph":   "biophysics",
  "physics.chem-ph":  "chemical-physics",
  "physics.comp-ph":  "computational-physics",
  "physics.flu-dyn":  "fluid-dynamics",
  "physics.med-ph":   "medical-physics",
  "physics.optics":   "optics",
  "cond-mat.soft":      "soft-matter",
  "cond-mat.stat-mech": "statistical-mechanics",
  "cond-mat.mes-hall":  "mesoscale-physics",
  "cond-mat.str-el":    "strongly-correlated-electrons",
  "astro-ph.CO": "cosmology",
  "astro-ph.GA": "galactic-astrophysics",
  "astro-ph.HE": "high-energy-astrophysics",
  "astro-ph.EP": "planetary-science",
  "astro-ph.SR": "solar-stellar-astrophysics",
  "hep-th":  "high-energy-physics-theory",
  "hep-ph":  "high-energy-physics-phenomenology",
  "hep-ex":  "high-energy-physics-experiment",
  "quant-ph": "quantum-physics",
  "gr-qc":    "general-relativity",
  "nucl-th":  "nuclear-theory",
  // EE & Systems Science
  "eess.SP": "signal-processing",
  "eess.IV": "image-video-processing",
  "eess.AS": "audio-speech-processing",
  "eess.SY": "systems-control",
  // Economics
  "econ.GN": "general-economics",
  "econ.EM": "econometrics",
  "econ.TH": "economic-theory",
};

var ArxivHelper = {
  /**
   * Fetch and translate arXiv subject categories for a given paper.
   *
   * The arXiv Atom API returns an XML feed with one <category> element per
   * subject. A paper typically has one primary category and one or more
   * cross-listed categories — all are included. Failures are non-fatal:
   * a warning is logged and an empty array is returned so the Claude tagging
   * stage can still proceed.
   *
   * @param {string} arxivID - Bare arXiv identifier, e.g. "2301.12345".
   * @returns {Promise<string[]>} Human-readable tag strings, one per category.
   *   Returns an empty array on network error or malformed response.
   */
  async fetchSubjectTags(arxivID) {
    try {
      const response = await fetch(ARXIV_API + arxivID);
      if (!response.ok) return [];

      const xml = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(xml, "application/xml");

      return [...doc.querySelectorAll("category")]
        .map(el => el.getAttribute("term"))
        .filter(Boolean)
        .map(code => ARXIV_CATEGORIES[code] || this._codeToTag(code));
    } catch (e) {
      Zotero.debug(
        `ZoteroAutoTagger: arXiv fetch failed for ${arxivID}: ${e.message}`,
        "warning"
      );
      return [];
    }
  },

  /**
   * Convert an unmapped arXiv category code to a tag string.
   *
   * Used as a fallback when a code is not in ARXIV_CATEGORIES — ensures new
   * or obscure categories produce a usable tag rather than being silently
   * dropped. The dot separator is replaced with a hyphen to match the
   * hyphenated convention used throughout the tag vocabulary.
   *
   * @param {string} code - arXiv category code, e.g. "cs.LG" or "econ.GN".
   * @returns {string} Lowercase hyphenated tag, e.g. "cs-lg" or "econ-gn".
   */
  _codeToTag(code) {
    return code.toLowerCase().replace(/\./g, "-");
  },
};
