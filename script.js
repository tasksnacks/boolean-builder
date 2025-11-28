// --- UI LOGIC ---
function switchTab(tab) {
  document.querySelectorAll('.segment-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.input-view').forEach(d => d.classList.add('hidden'));
  
  if(tab === 'ai') {
    document.querySelector('button[onclick="switchTab(\'ai\')"]').classList.add('active');
    document.getElementById('view-ai').classList.remove('hidden');
  } else {
    document.querySelector('button[onclick="switchTab(\'manual\')"]').classList.add('active');
    document.getElementById('view-manual').classList.remove('hidden');
  }
}

// --- CORE BOOLEAN LOGIC (Original) ---
const WORKER_URL = "https://boolean-builder-ai.yellowsteel.workers.dev";
const LINKEDIN_FREE_LIMIT = 100;
const LINKEDIN_FREE_SOFT_LIMIT = 130;

const TEMPLATES = {
  java_backend: {
    titles: "backend developer, backend engineer, software engineer",
    skills: "java, spring, microservices",
    locations: "berlin, hamburg",
    excludes: 'recruiter, hr',
    description: "Senior backend engineers with Java and Spring, Berlin or Hamburg."
  },
  react_frontend: {
    titles: "frontend developer, react developer",
    skills: "react, typescript, css",
    locations: "london, remote",
    excludes: 'recruiter, hr',
    description: "Frontend engineers with React and TypeScript, London or Remote."
  },
  sales_rep: {
    titles: "account executive, sales development representative",
    skills: "b2b, saas, closing, crm",
    locations: "remote, new york",
    excludes: 'recruiter, hr',
    description: "Sales reps with B2B SaaS experience."
  },
  devops_engineer: {
    titles: "devops engineer, sre",
    skills: "aws, kubernetes, docker, terraform",
    locations: "remote",
    excludes: 'recruiter',
    description: "DevOps engineers with AWS and Kubernetes."
  },
  data_analyst: {
    titles: "data analyst, bi analyst",
    skills: "sql, python, tableau, power bi",
    locations: "london",
    excludes: 'recruiter',
    description: "Data Analysts with SQL and Tableau."
  }
};

function splitTerms(str) {
  if (!str || !str.trim()) return [];
  return str.split(",").map(t => t.trim()).filter(Boolean).map(t => t.includes(" ") ? `"${t}"` : t);
}

function buildGroup(terms, joinWord) {
  if (!terms.length) return "";
  if (terms.length === 1) return terms[0];
  return "(" + terms.join(` ${joinWord} `) + ")";
}

function applyGoogleXRayPreset(core) {
  const trimmed = (core || "").trim();
  const baseFilter = '-intitle:jobs -intitle:"job" -inurl:jobs';
  if (!trimmed) return `site:linkedin.com/in ${baseFilter}`;
  if (trimmed.toLowerCase().includes("site:linkedin.com/in")) return trimmed;
  return `site:linkedin.com/in (${trimmed}) ${baseFilter}`;
}

function buildBooleanString({ titles, skills, locations, excludes, platform }) {
  const parts = [];
  const t = splitTerms(titles);
  const s = splitTerms(skills);
  const l = splitTerms(locations);
  const e = splitTerms(excludes);

  if (t.length) parts.push(buildGroup(t, "OR"));
  if (s.length) parts.push(buildGroup(s, "OR"));
  if (l.length) parts.push(buildGroup(l, "OR"));

  let core = parts.join(" AND ");
  if (e.length) core = core ? core + " NOT " + buildGroup(e, "OR") : "NOT " + buildGroup(e, "OR");

  if (platform === "google_xray") core = applyGoogleXRayPreset(core);
  return core;
}

// Compress Logic for LinkedIn Free
function compressForLinkedIn(query, targetLength) {
  let current = (query || "").trim();
  if (!current) return "";
  if (current.length <= targetLength) return current;

  // 1. Remove optional spacing around parens
  current = current.replace(/\( /g, "(").replace(/ \)/g, ")");

  function shortenOneGroup(str) {
    const groupRegex = /\([^()]*\)/g;
    let match;
    const groups = [];
    while ((match = groupRegex.exec(str)) !== null) {
      groups.push({ text: match[0], index: match.index });
    }
    // Try shortening longest group first
    groups.sort((a, b) => b.text.length - a.text.length);

    for (const g of groups) {
      const inner = g.text.slice(1, -1).trim();
      if (!inner.includes(" OR ")) continue;
      const terms = inner.split(/\s+OR\s+/);
      if (terms.length <= 1) continue;
      
      // Remove last term
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
  while (current.length > targetLength && safety < 15) {
    safety++;
    const { str, changed } = shortenOneGroup(current);
    current = str;
    if (!changed) break;
  }
  return current;
}

// --- DOM WIRING ---
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
  const platformTip = document.getElementById("platformTip");
  
  const nlPrompt = document.getElementById("nlPrompt");
  const aiPlatform = document.getElementById("aiPlatform");
  const aiGenerateBtn = document.getElementById("aiGenerateBtn");
  const aiStatus = document.getElementById("aiStatus");
  const templateButtons = document.querySelectorAll(".pill");

  function updateOutput(text, platform) {
    const p = platform || platformSelect.value;
    output.value = text || "";
    const len = (text || "").length;
    charCount.textContent = `${len} chars`;

    // LinkedIn Free Warnings
    compressBtn.classList.add('hidden');
    hint.textContent = "";
    
    if (p === 'linkedin_free') {
      if (len > LINKEDIN_FREE_LIMIT) {
        charCount.style.color = '#DC2626';
        hint.textContent = "Warning: String exceeds LinkedIn Free limit (~100 chars).";
        compressBtn.classList.remove('hidden');
      } else {
        charCount.style.color = '#059669';
      }
      platformTip.textContent = "LinkedIn Free searches work best with fewer than 5 operators.";
    } else if (p === 'google_xray') {
      platformTip.textContent = "Paste this directly into Google. We've added X-Ray operators.";
      charCount.style.color = '#6B7280';
    } else {
      platformTip.textContent = "LinkedIn Recruiter supports strings up to ~2000 chars.";
      charCount.style.color = '#6B7280';
    }
  }

  function applyTemplate(key) {
    const tpl = TEMPLATES[key];
    if(!tpl) return;
    titlesInput.value = tpl.titles;
    skillsInput.value = tpl.skills;
    locationsInput.value = tpl.locations;
    excludesInput.value = tpl.excludes;
    nlPrompt.value = tpl.description;
    
    const res = buildBooleanString({
      titles: tpl.titles, 
      skills: tpl.skills, 
      locations: tpl.locations, 
      excludes: tpl.excludes, 
      platform: 'linkedin_free'
    });
    updateOutput(res, 'linkedin_free');
  }

  templateButtons.forEach(btn => {
    btn.addEventListener('click', () => applyTemplate(btn.dataset.template));
  });

  generateBtn.addEventListener("click", () => {
    const res = buildBooleanString({
      titles: titlesInput.value,
      skills: skillsInput.value,
      locations: locationsInput.value,
      excludes: excludesInput.value,
      platform: platformSelect.value
    });
    updateOutput(res, platformSelect.value);
  });

  copyBtn.addEventListener("click", () => {
    if(!output.value) return;
    navigator.clipboard.writeText(output.value);
    
    const originalText = copyBtn.innerHTML;
    copyBtn.innerHTML = `<span class="icon">✓</span> Copied`;
    setTimeout(() => copyBtn.innerHTML = originalText, 1500);
  });

  compressBtn.addEventListener("click", () => {
    const current = output.value;
    if(!current) return;
    const compressed = compressForLinkedIn(current, LINKEDIN_FREE_LIMIT);
    updateOutput(compressed, 'linkedin_free');
  });

  // AI Logic
  aiGenerateBtn.addEventListener("click", async () => {
    const desc = nlPrompt.value.trim();
    if(!desc) { 
      aiStatus.textContent = "Please describe candidate."; 
      return; 
    }
    
    aiStatus.textContent = "Generating...";
    const platform = aiPlatform.value;
    const promptForAI = `Create a Boolean search string for ${platform} based on: "${desc}". Return ONLY the string.`;

    try {
      const res = await fetch(WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: promptForAI })
      });
      const data = await res.json();
      let bool = data.boolean || "";
      
      if(platform === 'google_xray') bool = applyGoogleXRayPreset(bool);
      
      updateOutput(bool, platform);
      aiStatus.textContent = "";
    } catch(e) {
      console.error(e);
      aiStatus.textContent = "Error connecting to AI.";
    }
  });
});
