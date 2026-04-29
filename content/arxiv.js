const ARXIV_API = "https://export.arxiv.org/api/query?id_list=";

// Maps arXiv category codes to human-readable hyphenated tags
const ARXIV_CATEGORIES = {
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

const ArxivHelper = {
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
      Zotero.log(
        `ZoteroAutoTagger: arXiv fetch failed for ${arxivID}: ${e.message}`,
        "warning"
      );
      return [];
    }
  },

  // Fallback for unmapped codes: "cs.LG" → "cs-lg"
  _codeToTag(code) {
    return code.toLowerCase().replace(/\./g, "-");
  },
};
