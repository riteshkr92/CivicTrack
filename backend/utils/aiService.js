/**
 * CivicTrack — AI-Assisted Civic Intelligence Service
 *
 * Implements:
 * 1. Category Classification: Recommends valid categories from VALID_CATEGORIES with confidence score.
 * 2. Priority Recommendation: Suggests defensible priority (Low, Medium, High, Urgent) with operational rationale.
 * 3. Potential Duplicate Detection: Discovers open nearby complaints within 500m without leaking private information.
 * 4. Dual Engine: Local offline semantic NLP classifier (zero API cost, privacy-first) with optional pluggable Google Gemini API.
 */

const { calculateDistanceMeters } = require('./exifParser');
const { VALID_CATEGORIES, VALID_PRIORITIES } = require('../models/Complaint');

// Semantic keywords and domain tokens for local civic NLP classification
const CATEGORY_LEXICON = {
  'Pothole/Road Damage': {
    weight: 1.0,
    keywords: [
      'pothole', 'potholes', 'crater', 'craters', 'road', 'roads', 'street',
      'asphalt', 'pavement', 'tar', 'surface', 'speed breaker', 'speedbreaker',
      'bump', 'bumps', 'crack', 'cracks', 'ditch', 'manhole cover broken',
      'damaged road', 'uneven surface', 'cave in', 'cave-in', 'sinkhole',
      'divider broken', 'divider', 'gravel', 'curb', 'kerb'
    ]
  },
  'Garbage/Waste': {
    weight: 1.0,
    keywords: [
      'garbage', 'trash', 'waste', 'debris', 'dump', 'dumping', 'litter',
      'littering', 'stench', 'smell', 'rotting', 'compost', 'plastic',
      'dustbin', 'bin', 'bins', 'overflowing bin', 'overflow', 'sanitation',
      'dumpster', 'waste pile', 'refuse', 'foul odor', 'bio waste', 'sweep'
    ]
  },
  'Streetlight': {
    weight: 1.0,
    keywords: [
      'streetlight', 'street light', 'streetlights', 'light', 'lights',
      'lamp', 'lamps', 'lamppost', 'bulb', 'bulbs', 'pole', 'darkness',
      'dark', 'flicker', 'flickering', 'illumination', 'fixture',
      'street lighting', 'dark street', 'night visibility', 'streetlamp'
    ]
  },
  'Drainage/Waterlogging': {
    weight: 1.0,
    keywords: [
      'drainage', 'drain', 'drains', 'waterlogging', 'waterlogged',
      'flood', 'flooding', 'stormwater', 'storm water', 'storm drain',
      'gutter', 'gutters', 'clogged drain', 'clogged gutter', 'sewage',
      'sewer', 'sewers', 'sewer overflow', 'dirty water', 'stagnant',
      'stagnant water', 'culvert', 'blockage'
    ]
  },
  'Water Supply': {
    weight: 1.0,
    keywords: [
      'water supply', 'water pipeline', 'pipeline', 'pipe burst', 'burst pipe',
      'drinking water', 'tap water', 'water tap', 'water pressure', 'no water',
      'water cut', 'contaminated water', 'muddy water', 'discolored water',
      'leak', 'leaking water', 'water leakage', 'borewell', 'water tanker'
    ]
  }
};

// Priority heuristic indicators
const PRIORITY_INDICATORS = {
  Urgent: [
    'danger', 'dangerous', 'hazard', 'hazardous', 'emergency', 'life threatening',
    'electrocution', 'live wire', 'electric shock', 'exposed wire', 'gas leak',
    'toxic', 'building collapse', 'bridge collapse', 'sinkhole', 'cave-in',
    'submerged home', 'homes flooded', 'fatal', 'accident prone', 'ambulance blocked'
  ],
  High: [
    'contaminated', 'dirty drinking water', 'open manhole', 'main road',
    'heavy traffic', 'school zone', 'hospital route', 'overflowing sewage',
    'disease risk', 'major rupture', 'total darkness', 'arterial road'
  ],
  Medium: [
    'standard', 'pothole', 'residential', 'trash', 'uncollected', 'broken lamp',
    'flickering', 'leak', 'slow drain', 'water pressure'
  ],
  Low: [
    'minor', 'cosmetic', 'graffiti', 'dried leaves', 'tilted sign', 'paint peeling',
    'small crack', 'slight flicker', 'faint'
  ]
};

/**
 * Local Semantic NLP Classifier
 * Evaluates text against civic domain lexicons using term weighting and token matching.
 */
function classifyWithLocalNlp(text) {
  const normalized = (text || '').toLowerCase();
  const scores = {};

  for (const [category, config] of Object.entries(CATEGORY_LEXICON)) {
    let score = 0;
    for (const kw of config.keywords) {
      // Word boundary match
      const regex = new RegExp(`\\b${kw.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'gi');
      const matches = normalized.match(regex);
      if (matches) {
        // Longer key phrases carry higher specificity
        const specificity = kw.includes(' ') ? 1.8 : 1.0;
        score += matches.length * specificity * config.weight;
      }
    }
    scores[category] = score;
  }

  // Find category with highest match score
  let bestCategory = 'Other';
  let highestScore = 0;
  let totalScore = 0;

  for (const [category, score] of Object.entries(scores)) {
    totalScore += score;
    if (score > highestScore) {
      highestScore = score;
      bestCategory = category;
    }
  }

  // Confidence calculation
  let confidence = 0.5;
  if (totalScore > 0 && highestScore > 0) {
    const rawRatio = highestScore / totalScore;
    confidence = Math.min(0.96, Math.max(0.45, Number((rawRatio * 0.8 + 0.2).toFixed(2))));
  } else {
    bestCategory = 'Other';
    confidence = 0.4;
  }

  // Generate category reasoning
  let categoryReasoning = `Classified as ${bestCategory} based on civic keyword analysis.`;
  if (bestCategory !== 'Other' && highestScore > 0) {
    const matchedTokens = CATEGORY_LEXICON[bestCategory].keywords.filter((kw) =>
      normalized.includes(kw)
    );
    const topKeywords = matchedTokens.slice(0, 3).map((k) => `"${k}"`).join(', ');
    categoryReasoning = `Classified as "${bestCategory}" (${Math.round(confidence * 100)}% confidence) based on detected civic indicators: ${topKeywords}.`;
  } else {
    categoryReasoning = 'No high-specificity municipal category detected. Recommended category is "Other" for general staff triage.';
  }

  return {
    category: bestCategory,
    confidence,
    categoryReasoning
  };
}

/**
 * Local Priority Recommender
 * Determines recommended priority based on safety risk, hazard scale, and domain criteria.
 */
function recommendPriorityWithLocalNlp(text, category) {
  const normalized = (text || '').toLowerCase();

  // Check Urgent indicators first
  for (const indicator of PRIORITY_INDICATORS.Urgent) {
    if (normalized.includes(indicator)) {
      return {
        priority: 'Urgent',
        priorityRationale: `Recommended priority is "Urgent" due to critical safety hazard keyword ("${indicator}"). Awaiting official officer confirmation.`
      };
    }
  }

  // Check High indicators
  for (const indicator of PRIORITY_INDICATORS.High) {
    if (normalized.includes(indicator)) {
      return {
        priority: 'High',
        priorityRationale: `Recommended priority is "High" due to significant public health or community disruption indicator ("${indicator}").`
      };
    }
  }

  // Check Low indicators
  for (const indicator of PRIORITY_INDICATORS.Low) {
    if (normalized.includes(indicator)) {
      return {
        priority: 'Low',
        priorityRationale: `Recommended priority is "Low" for routine non-hazardous civic maintenance ("${indicator}").`
      };
    }
  }

  // Category-based default baseline
  if (category === 'Drainage/Waterlogging' || category === 'Water Supply') {
    return {
      priority: 'Medium',
      priorityRationale: 'Recommended priority is "Medium" for standard municipal water/drainage maintenance. Subject to field officer triage.'
    };
  }

  return {
    priority: 'Medium',
    priorityRationale: 'Recommended priority is "Medium" as a standard baseline civic service order. Official priority will be assigned by municipal triage staff.'
  };
}

/**
 * Gemini Cloud API Provider (Optional)
 * Calls Google Gemini if GEMINI_API_KEY is configured in backend environment.
 */
async function analyzeWithGemini(title, description) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    return null;
  }

  const promptText = `
You are the AI Civic Intelligence Engine for CivicTrack, a municipal complaint triage platform.
Analyze this citizen-submitted civic issue:

Title: "${title}"
Description: "${description}"

Supported categories (must choose exactly one):
${JSON.stringify(VALID_CATEGORIES)}

Supported priorities (must choose exactly one):
${JSON.stringify(VALID_PRIORITIES)}

Respond strictly in valid JSON matching this exact structure:
{
  "category": "One of supported categories",
  "confidence": 0.0 to 1.0,
  "categoryReasoning": "One concise sentence explaining the category recommendation based on the issue details",
  "priority": "One of supported priorities",
  "priorityRationale": "One concise sentence explaining why this priority is recommended, noting it is a recommendation subject to staff confirmation"
}
`.trim();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000); // 4-second timeout

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(
      apiKey.trim()
    )}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: promptText }]
          }
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json'
        }
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[AI Service] Gemini API returned HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidateText) return null;

    const parsed = JSON.parse(candidateText.trim());

    // Strict validation against supported enums
    if (!VALID_CATEGORIES.includes(parsed.category) || !VALID_PRIORITIES.includes(parsed.priority)) {
      console.warn('[AI Service] Gemini returned unsupported category or priority:', parsed);
      return null;
    }

    return {
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      category: parsed.category,
      confidence: typeof parsed.confidence === 'number' ? Math.min(0.99, Math.max(0.1, parsed.confidence)) : 0.85,
      categoryReasoning: parsed.categoryReasoning || `Recommended as ${parsed.category}.`,
      priority: parsed.priority,
      priorityRationale: parsed.priorityRationale || `Recommended as ${parsed.priority}.`
    };
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn('[AI Service] Gemini request failed or timed out:', err.message);
    return null;
  }
}

/**
 * Main AI Analysis Engine (Dual Engine: Gemini with automatic local NLP fallback)
 */
async function analyzeComplaint({ title, description, coordinates }) {
  const safeTitle = (title || '').trim();
  const safeDescription = (description || '').trim();
  const combinedText = `${safeTitle} ${safeDescription}`.trim();

  if (!combinedText) {
    return {
      provider: 'local_nlp',
      model: 'civictrack-heuristic-nlp-v1',
      category: 'Other',
      confidence: 0.1,
      categoryReasoning: 'Insufficient complaint text provided for automated classification.',
      priority: 'Low',
      priorityRationale: 'Default priority recommendation for unclassified submissions.'
    };
  }

  // 1. Try Gemini API first if configured
  if (process.env.GEMINI_API_KEY) {
    try {
      const geminiResult = await analyzeWithGemini(safeTitle, safeDescription);
      if (geminiResult) {
        return geminiResult;
      }
    } catch (e) {
      // Fall through to local NLP
    }
  }

  // 2. Local Semantic NLP Classification
  const nlpClass = classifyWithLocalNlp(combinedText);
  const nlpPriority = recommendPriorityWithLocalNlp(combinedText, nlpClass.category);

  return {
    provider: 'local_nlp',
    model: 'civictrack-heuristic-nlp-v1',
    category: nlpClass.category,
    confidence: nlpClass.confidence,
    categoryReasoning: nlpClass.categoryReasoning,
    priority: nlpPriority.priority,
    priorityRationale: nlpPriority.priorityRationale
  };
}

/**
 * Potential Duplicate Complaint Finder
 * Identifies open issues in the same category or matching keywords within 500m.
 * Strictly sanitizes output: NEVER leaks citizen name, email, phone, or private notes.
 */
async function findPotentialDuplicates(ComplaintModel, { title, category, coordinates, excludeId = null }) {
  if (!ComplaintModel || (!title && !category)) {
    return [];
  }

  try {
    const filter = {
      status: { $in: ['Submitted', 'Under Review', 'In Progress'] }
    };

    if (excludeId) {
      filter._id = { $ne: excludeId };
    }

    // Build query conditions
    const orConditions = [];
    if (category && VALID_CATEGORIES.includes(category) && category !== 'Other') {
      orConditions.push({ category });
    }

    // Extract significant keywords from title (words >= 4 chars)
    if (title && typeof title === 'string') {
      const words = title
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter((w) => w.length >= 4 && !['issue', 'road', 'please', 'near', 'near by', 'area', 'ward'].includes(w));

      if (words.length > 0) {
        const titleRegex = new RegExp(words.slice(0, 3).join('|'), 'i');
        orConditions.push({ title: { $regex: titleRegex } });
      }
    }

    if (orConditions.length > 0) {
      filter.$or = orConditions;
    }

    // Fetch candidate open complaints (limit 20 for in-memory distance filtering)
    const candidates = await ComplaintModel.find(filter)
      .select('trackingId title category status location createdAt')
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    const matches = [];
    const hasCoords =
      coordinates &&
      typeof coordinates.latitude === 'number' &&
      typeof coordinates.longitude === 'number' &&
      !isNaN(coordinates.latitude) &&
      !isNaN(coordinates.longitude);

    for (const c of candidates) {
      let distanceMeters = null;

      if (hasCoords && c.location?.latitude && c.location?.longitude) {
        try {
          distanceMeters = calculateDistanceMeters(
            coordinates.latitude,
            coordinates.longitude,
            c.location.latitude,
            c.location.longitude
          );
        } catch (e) {}
      }

      // If user provided coordinates, prioritize complaints within 500 meters
      if (hasCoords) {
        if (distanceMeters !== null && distanceMeters <= 500) {
          matches.push({
            id: c._id.toString(),
            trackingId: c.trackingId,
            title: c.title,
            category: c.category,
            status: c.status,
            createdAt: c.createdAt,
            approxDistanceMeters: Math.round(distanceMeters)
          });
        }
      } else {
        // Without coordinates, match on category and keyword relevance
        matches.push({
          id: c._id.toString(),
          trackingId: c.trackingId,
          title: c.title,
          category: c.category,
          status: c.status,
          createdAt: c.createdAt,
          approxDistanceMeters: null
        });
      }

      if (matches.length >= 3) break;
    }

    return matches;
  } catch (error) {
    console.warn('[AI Service] Duplicate search error:', error.message);
    return [];
  }
}

module.exports = {
  analyzeComplaint,
  classifyWithLocalNlp,
  recommendPriorityWithLocalNlp,
  findPotentialDuplicates
};
