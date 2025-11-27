/* =========================================
   ========================================= */
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('#view-ai, #view-manual').forEach(d => d.classList.add('hidden'));
  
  if(tab === 'ai') {
    document.querySelector('button[onclick="switchTab(\'ai\')"]').classList.add('active');
    document.getElementById('view-ai').classList.remove('hidden');
  } else {
    document.querySelector('button[onclick="switchTab(\'manual\')"]').classList.add('active');
    document.getElementById('view-manual').classList.remove('hidden');
  }
}

/* =========================================
   ========================================= */
// STEP 1: replace this with my Cloudflare Worker URL
const WORKER_URL = "https://boolean-builder-ai.yellowsteel.workers.dev";

const LINKEDIN_FREE_LIMIT = 100;      // hard target
const LINKEDIN_FREE_SOFT_LIMIT = 130; // warn + allow compression

// Predefined templates for Phase 1
const TEMPLATES = {
  java_backend: {
    label: "Java Backend Dev",
    titles: "backend developer, backend engineer, software engineer",
    skills: "java, spring, microservices, sql, rest api",
    locations: "berlin, hamburg",
    excludes: 'recruiter, "talent acquisition", hr',
    description:
      "Senior backend engineers with Java and Spring experience, microservices and REST APIs, based in Berlin or Hamburg. Exclude recruiters and HR profiles.",
  },
  react_frontend: {
    label: "React Frontend Dev",
    titles: "frontend developer, frontend engineer, react developer",
    skills: "react, javascript, typescript, css, html",
    locations: "london, remote",
    excludes: 'recruiter, "talent acquisition", hr',
    description:
      "Frontend engineers with strong React and JavaScript/TypeScript skills, in London or remote-friendly. Exclude recruiters and HR.",
  },
  devops_engineer: {
    label: "DevOps Engineer",
    titles: "devops engineer, site reliability engineer, sre",
    skills: "aws, kubernetes, docker, ci/cd, terraform",
    locations: "berlin, munich, remote",
    excludes: 'recruiter, "talent acquisition", hr',
    description:
      "DevOps / SRE profiles with AWS, Kubernetes, Docker and CI/CD experience, based in Germany or remote. Exclude recruiters and HR.",
  },
  data_analyst: {
    label: "Data Analyst",
    titles: "data analyst, bi analyst, business intelligence analyst",
    skills: "sql, excel, tableau, power bi, dashboards, reporting",
    locations: "amsterdam, rotterdam, remote",
    excludes: 'recruiter, "talent acquisition", hr',
    description:
      "Data analysts with SQL and BI tools like Tableau or Power BI, based in the Netherlands or remote. Exclude recruiters and HR.",
  },
  sales_rep: {
    label: "Sales Representative",
    titles:
      "sales representative, account executive, sales executive, business development",
    skills: "b2b sales, cold calling, crm, pipeline, negotiation",
    locations: "paris, lyon, remote",
    excludes: 'recruiter, "talent acquisition", hr',
    description:
      "B2B sales reps / account executives with CRM experience, strong pipeline management and negotiation skills, in France or remote. Exclude recruiters and HR.",
  },
};

// --- Helper functions for local Boolean generation ---

function splitTerms(str) {
  if (!str.trim()) return [];
  return str
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => {
      if (t.includes(" ")) {
        return `"${t}"`;
      }
      return t;
    });
}

function buildGroup(terms, joinWord) {
  if (!terms.length) return "";
  if (terms.length === 1) return terms[0];
  return "(" + terms.join(` ${joinWord} `) + ")";
}

// Google X-Ray helper
function applyGoogleXRayPreset(core) {
  const trimmed = (core || "").trim();
  const baseFilter =
    '-intitle:jobs -intitle:"job" -intitle:"hiring" -inurl:jobs -inurl:"/jobs/" -inurl:"/talent/"';

  if (!trimmed) {
    // If there is no core query, just return a generic LinkedIn people search
    return `site:linkedin.com/in ${baseFilter}`;
  }

  const lower = trimmed.toLowerCase();

  // If the user / AI already included site:linkedin.com/in, don't duplicate it
  if (lower.includes("site:linkedin.com/in")) {
    // If it already has our filters, just return as is
    if (lower.includes("-intitle:jobs") || lower.includes("-inurl:jobs")) {
      return trimmed;
    }
    // Otherwise, append our standard filters
    return `${trimmed} ${baseFilter}`;
  }

  // Normal case: wrap the core in site:linkedin.com/in plus filters
  return `site:linkedin.com/in (${trimmed}) ${baseFilter}`;
}

function buildBooleanString({ titles, skills, locations, excludes, platform }) {
  const titleTerms = splitTerms(titles);
  const skillTerms = splitTerms(skills);
  const locationTerms = splitTerms(locations);
  const excludeTerms = splitTerms(excludes);

  const parts = [];

  const titlesGroup = buildGroup(titleTerms, "OR");
  if (titlesGroup) parts.push(titlesGroup);

  const skillsGroup = buildGroup(skillTerms, "OR");
  if (skillsGroup) parts.push(skillsGroup);

  const locationsGroup = buildGroup(locationTerms, "OR");
  if (locationsGroup) parts.push(locationsGroup);

  let core = parts.join(" AND ");

  if (excludeTerms.length) {
    const excludeGroup = buildGroup(excludeTerms, "OR");
    core = core ? core + " NOT " + excludeGroup : "NOT " + excludeGroup;
  }

  if (platform === "google_xray") {
    core = applyGoogleXRayPreset(core);
  }

  return core;
}

// Try to compress a Boolean string to fit LinkedIn Free by removing extra OR terms.
function compressForLinkedIn(query, targetLength) {
  let current = (query || "").trim();
  if (!current) return "";

  // Already small enough
  if (current.length <= targetLength) return current;

  // Helper: try to shorten the longest OR-group inside parentheses
  function shortenOneGroup(str) {
    const groupRegex = /\([^()]*\)/g;
    let match;
    const groups = [];

    // Collect all simple (...) groups (no nested parentheses)
    while ((match = groupRegex.exec(str)) !== null) {
      groups.push({ text: match[0], index: match.index });
    }

    // Work on the longest groups first (most impact)
    groups.sort((a, b) => b.text.length - a.text.length);

    for (const g of groups) {
      const inner = g.text.slice(1, -1).trim(); // content without outer parentheses
      if (!inner.includes(" OR ")) continue;

      const terms = inner.split(/\s+OR\s+/);
      if (terms.length <= 1) continue;

      // Remove the last term in this OR group
      terms.pop();
      const newInner = terms.join(" OR ");
      const newGroup = "(" + newInner + ")";

      const before = str.slice(0, g.index);
      const after = str.slice(g.index + g.text.length);
      const combined = (before + newGroup + after).replace(/\s+/g, " ").trim();

      return { str: combined, changed: true };
    }

    return { str, changed: false };
  }

  let safety = 0;
  while (current.length > targetLength && safety < 25) {
    safety++;
    const { str, changed } = shortenOneGroup(current);
    current = str;
    if (!changed) break; // nothing else to shorten
  }

  // If still too long, try dropping the NOT clause at the end
  if (current.length > targetLength) {
    const notIndex = current.indexOf(" NOT ");
    if (notIndex !== -1) {
      current = current.slice(0, notIndex).trim();
    }
  }

  return current;
}
function getHint(platform, length) {
  if (platform === "linkedin_free") {
    if (length > 100) {
      return "⚠ LinkedIn Free often breaks queries over ~100 characters. Try removing some terms.";
    }
    return "This should be safe for LinkedIn Free. Always test on LinkedIn.";
  }

  if (platform === "linkedin_recruiter") {
    return "ℹ LinkedIn Recruiter allows much longer strings, but keep them readable for your future self.";
  }

  if (platform === "google_xray") {
    return "ℹ This query is formatted as a Google X-Ray search for LinkedIn profiles. Paste it into Google Search.";
  }

  return "";
}

// --- DOM wiring ---

document.addEventListener("DOMContentLoaded", () => {
  const titlesInput = document.getElementById("titles");
  const skillsInput = document.getElementById("skills");
  const locationsInput = document.getElementById("locations");
  const excludesInput = document.getElementById("excludes");
  const platformSelect = document.getElementById("platform");
  const output = document.getElementById("output");
  const generateBtn = document.getElementById("generateBtn");
  const copyBtn = document.getElementById("copyBtn");
  const compressBtn = document.getElementById("compressBtn");
  const charCount = document.getElementById("charCount");
  const hint = document.getElementById("hint");

  let lastPlatform = "linkedin_free";

  const nlPrompt = document.getElementById("nlPrompt");
  const aiPlatform = document.getElementById("aiPlatform");
  const aiGenerateBtn = document.getElementById("aiGenerateBtn");
  const aiStatus = document.getElementById("aiStatus");
  const templateButtons = document.querySelectorAll(".template-btn");

  function updateOutput(text, platform) {
    lastPlatform = platform || lastPlatform;

    const value = text || "";
    output.value = value;

    const length = value.length;
    charCount.textContent = `${length} characters`;

    // Reset color classes
    charCount.classList.remove("char-ok", "char-warn", "char-danger");

    // Default: hide compress button
    if (compressBtn) {
      compressBtn.style.display = "none";
    }

    // LinkedIn Free: show warnings + compress option
    if (lastPlatform === "linkedin_free") {
      if (!value) {
        charCount.classList.add("char-ok");
      } else if (length <= LINKEDIN_FREE_LIMIT) {
        charCount.classList.add("char-ok");
      } else if (length <= LINKEDIN_FREE_SOFT_LIMIT) {
        charCount.classList.add("char-warn");
        if (compressBtn) compressBtn.style.display = "inline-block";
      } else {
        charCount.classList.add("char-danger");
        if (compressBtn) compressBtn.style.display = "inline-block";
      }
    } else {
      // Non-LinkedIn platforms: just neutral
      charCount.classList.add("char-ok");
    }

    hint.textContent = value ? getHint(lastPlatform, length) : "";
  }

  function applyTemplate(templateKey) {
    const tpl = TEMPLATES[templateKey];
    if (!tpl) return;

    titlesInput.value = tpl.titles;
    skillsInput.value = tpl.skills;
    locationsInput.value = tpl.locations;
    // Handle hidden input
    if(excludesInput) excludesInput.value = tpl.excludes;

    // Default structured platform: LinkedIn Free
    platformSelect.value = "linkedin_free";

    // Also pre-fill AI prompt so they can use the AI version immediately
    if (nlPrompt) {
      nlPrompt.value = tpl.description;
    }

    // Auto-generate a structured Boolean immediately for quick feedback
    const booleanString = buildBooleanString({
      titles: titlesInput.value,
      skills: skillsInput.value,
      locations: locationsInput.value,
      excludes: excludesInput ? excludesInput.value : "",
      platform: platformSelect.value,
    });
    updateOutput(booleanString, platformSelect.value);
  }

  templateButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-template");
      applyTemplate(key);
    });
  });

  function generate() {
    const booleanString = buildBooleanString({
      titles: titlesInput.value,
      skills: skillsInput.value,
      locations: locationsInput.value,
      excludes: excludesInput ? excludesInput.value : "",
      platform: platformSelect.value,
    });

    updateOutput(booleanString, platformSelect.value);
  }

  generateBtn.addEventListener("click", generate);

  copyBtn.addEventListener("click", () => {
    if (!output.value) return;
    navigator.clipboard.writeText(output.value).then(() => {
      copyBtn.textContent = "Copied!";
      setTimeout(() => (copyBtn.textContent = "Copy"), 1200);
    });
  });
  if (compressBtn) {
    compressBtn.addEventListener("click", () => {
      const current = output.value || "";
      if (!current) return;

      const compressed = compressForLinkedIn(current, LINKEDIN_FREE_LIMIT);

      if (compressed && compressed.length < current.length) {
        updateOutput(compressed, "linkedin_free");
        hint.textContent =
          "Compressed for LinkedIn Free. Review the query to ensure it still matches your intent.";
      } else {
        hint.textContent =
          "Couldn't safely compress much further. Try manually removing some titles, skills, or locations.";
      }
    });
  }
  // --- AI integration via Cloudflare Worker ---
  async function generateWithAI() {
    const description = nlPrompt.value.trim();
    const platform = aiPlatform.value;

    if (!description) {
      aiStatus.textContent = "Please describe your ideal candidate first.";
      return;
    }

    if (!WORKER_URL.startsWith("https://")) {
      aiStatus.textContent =
        "AI is not configured yet. Add your Cloudflare Worker URL in script.js.";
      return;
    }

    aiStatus.textContent = "Asking AI (DeepSeek) to build your Boolean…";

    const platformText =
      platform === "linkedin_free"
        ? "LinkedIn Free"
        : platform === "linkedin_recruiter"
        ? "LinkedIn Recruiter"
        : "Google X-Ray (site:linkedin.com/in)";

    const promptForAI = `
You are an expert tech recruiter and Boolean search specialist.

Task:
- Create a Boolean search string for: ${platformText}.
- It is for sourcing candidates based on this description:
"${description}"

Rules:
- Return ONLY the Boolean string. No explanations.
- Use AND / OR / NOT and parentheses correctly.
- If the platform is "LinkedIn Free":
    - DO NOT include 'site:linkedin.com/in'
    - DO NOT include 'intitle:' or 'inurl:'
    - DO NOT include Google operators like -inurl, -intitle, site:, etc.
    - Output only pure LinkedIn Boolean logic.
- If the platform is "LinkedIn Recruiter":
    - Same as LinkedIn Free, but longer strings are allowed.
- If the platform is "Google X-Ray":
    - MUST include 'site:linkedin.com/in'
    - MUST exclude job listings using -intitle: and -inurl:
    IMPORTANT:
You MUST follow the platform-specific rules exactly.
`.trim();

    try {
      const response = await fetch(WORKER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt: promptForAI }),
      });

      if (!response.ok) {
        aiStatus.textContent =
          "AI request failed. Check your Cloudflare Worker or API key.";
        return;
      }

      const data = await response.json();
      let booleanString = (data.boolean || "").trim();

      if (!booleanString) {
        aiStatus.textContent =
          "AI responded, but I couldn't read a Boolean string from it.";
        return;
      }

      // If target is Google X-Ray, wrap / normalize the AI output
      if (platform === "google_xray") {
        booleanString = applyGoogleXRayPreset(booleanString);
      }

      updateOutput(booleanString, platform);
      aiStatus.textContent = "Done! Boolean string generated by AI.";
    } catch (err) {
      console.error(err);
      aiStatus.textContent =
        "Network error talking to AI. Check your internet or Worker URL.";
    }
  }

  aiGenerateBtn.addEventListener("click", generateWithAI);
});
