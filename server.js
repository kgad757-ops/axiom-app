require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const pdfParse = require('pdf-parse');

const app = express();
const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Multer — memory storage, 50MB limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.csv', '.tsv', '.xlsx', '.xls', '.json', '.pdf', '.txt'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Unsupported file type: ' + ext));
  }
});

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── FILE PARSE ENDPOINT ─────────────────────────────────────────────────────
app.post('/api/parse', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const ext = path.extname(req.file.originalname).toLowerCase();
  let rows = [], headers = [], rawText = '', sheetName = '';

  try {
    if (ext === '.csv' || ext === '.tsv' || ext === '.txt') {
      const Papa = require('papaparse');
      const text = req.file.buffer.toString('utf8');
      const result = Papa.parse(text, { header: true, skipEmptyLines: true, dynamicTyping: true });
      rows = result.data;
      headers = result.meta.fields || [];

    } else if (ext === '.xlsx' || ext === '.xls') {
      const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
      sheetName = wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json(ws, { defval: null });
      rows = json;
      headers = json.length ? Object.keys(json[0]) : [];

    } else if (ext === '.json') {
      const parsed = JSON.parse(req.file.buffer.toString('utf8'));
      if (Array.isArray(parsed)) {
        rows = parsed;
        headers = parsed.length ? Object.keys(parsed[0]) : [];
      } else if (typeof parsed === 'object') {
        // Try to find array inside object
        const arrKey = Object.keys(parsed).find(k => Array.isArray(parsed[k]) && parsed[k].length > 0);
        if (arrKey) {
          rows = parsed[arrKey];
          headers = rows.length ? Object.keys(rows[0]) : [];
        } else {
          rawText = JSON.stringify(parsed, null, 2).substring(0, 12000);
        }
      }

    } else if (ext === '.pdf') {
      const data = await pdfParse(req.file.buffer);
      rawText = data.text.substring(0, 15000);
    }

    // Compute server-side statistics
    const stats = computeStats(rows, headers);
    const categoricals = computeCategoricals(rows, headers);
    const preview = rows.slice(0, 25);

    res.json({
      success: true,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      ext,
      rows: rows.length,
      headers,
      preview,
      stats,
      categoricals,
      rawText,
      sheetName
    });

  } catch (err) {
    res.status(500).json({ error: 'Parse error: ' + err.message });
  }
});

// ─── AI ANALYSIS ENDPOINT ────────────────────────────────────────────────────
app.post('/api/analyze', async (req, res) => {
  const { fileName, rows, headers, preview, stats, categoricals, rawText, ext } = req.body;

  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on server' });
  }

  // Build rich data context
  let dataContext = buildDataContext({ fileName, rows, headers, preview, stats, categoricals, rawText, ext });

  const systemPrompt = buildSystemPrompt();

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: dataContext }]
      })
    });

    const data = await response.json();

    if (data.error) return res.status(500).json({ error: data.error.message });

    const raw = data.content.map(c => c.text || '').join('');
    // Strip any markdown fences
    const clean = raw.replace(/^```json\s*/m, '').replace(/\s*```$/m, '').trim();

    let report;
    try {
      report = JSON.parse(clean);
    } catch (e) {
      // Try extracting JSON from response
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) report = JSON.parse(match[0]);
      else return res.status(500).json({ error: 'AI returned invalid JSON. Try again.' });
    }

    res.json({ success: true, report });

  } catch (err) {
    res.status(500).json({ error: 'AI analysis failed: ' + err.message });
  }
});

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function computeStats(rows, headers) {
  const stats = {};
  if (!rows.length || !headers.length) return stats;

  headers.forEach(h => {
    const vals = rows.map(r => parseFloat(r[h])).filter(v => !isNaN(v) && isFinite(v));
    if (vals.length < rows.length * 0.25) return;

    vals.sort((a, b) => a - b);
    const sum = vals.reduce((a, b) => a + b, 0);
    const mean = sum / vals.length;
    const variance = vals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / vals.length;
    const mid = Math.floor(vals.length / 2);
    const median = vals.length % 2 === 0 ? (vals[mid - 1] + vals[mid]) / 2 : vals[mid];
    const q1 = vals[Math.floor(vals.length * 0.25)];
    const q3 = vals[Math.floor(vals.length * 0.75)];

    stats[h] = {
      count: vals.length,
      min: +vals[0].toFixed(4),
      max: +vals[vals.length - 1].toFixed(4),
      sum: +sum.toFixed(4),
      mean: +mean.toFixed(4),
      median: +median.toFixed(4),
      stdDev: +Math.sqrt(variance).toFixed(4),
      q1: +q1.toFixed(4),
      q3: +q3.toFixed(4),
      nullCount: rows.length - vals.length
    };
  });
  return stats;
}

function computeCategoricals(rows, headers) {
  const cats = {};
  if (!rows.length || !headers.length) return cats;

  headers.forEach(h => {
    const vals = rows.map(r => r[h]).filter(v => v !== null && v !== undefined && v !== '');
    const numericCount = vals.filter(v => !isNaN(parseFloat(v))).length;
    if (numericCount > vals.length * 0.5) return;

    const freq = {};
    vals.forEach(v => {
      const k = String(v).trim();
      freq[k] = (freq[k] || 0) + 1;
    });

    const sorted = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15);

    if (sorted.length >= 2 && sorted.length <= 50) {
      cats[h] = {
        distribution: sorted,
        unique: Object.keys(freq).length,
        nullCount: rows.length - vals.length
      };
    }
  });
  return cats;
}

function buildDataContext({ fileName, rows, headers, preview, stats, categoricals, rawText, ext }) {
  if (rawText && !rows) {
    return `FILE: ${fileName}\nTYPE: ${ext}\n\nEXTRACTED CONTENT:\n${rawText}`;
  }

  const sampleRows = (preview || []).slice(0, 50);
  const sampleCSV = headers.length
    ? [headers.join('\t'), ...sampleRows.map(r => headers.map(h => r[h] ?? '').join('\t'))].join('\n')
    : '';

  return `DATASET ANALYSIS REQUEST
========================
File: ${fileName}
Total Rows: ${(rows || 0).toLocaleString()}
Columns (${headers.length}): ${headers.join(', ')}

NUMERIC COLUMN STATISTICS:
${JSON.stringify(stats, null, 2)}

CATEGORICAL DISTRIBUTIONS:
${JSON.stringify(categoricals, null, 2)}

DATA SAMPLE (first 50 rows):
${sampleCSV}`;
}

function buildSystemPrompt() {
  return `You are AXIOM, a world-class senior data analyst and business intelligence specialist. You produce rigorous, professional, data-driven reports indistinguishable from those produced by top consulting firms (McKinsey, Deloitte, BCG).

Your analysis is always:
- SPECIFIC: Use exact numbers, percentages, and comparisons from the actual data
- INSIGHTFUL: Surface non-obvious patterns, outliers, correlations, and business implications
- ACTIONABLE: Every recommendation must be concrete and implementable
- ACCURATE: Never fabricate numbers — only use what is in the data

CRITICAL: Respond ONLY with a single valid JSON object. No markdown, no preamble, no explanation outside the JSON.

Required JSON structure:
{
  "reportTitle": "Specific descriptive title based on the actual data domain",
  "reportSubtitle": "One precise sentence: what was analyzed, key finding, time scope if detectable",
  "domain": "sales|finance|hr|operations|marketing|survey|healthcare|logistics|other",
  "kpis": [
    { "label": "KPI name", "value": "formatted value", "sub": "context/comparison", "trend": "up|down|neutral" }
  ],
  "executiveSummary": "HTML string (use <p><strong><ul><li><span> only). 3-4 paragraphs. Lead with the single most important finding. Include specific numbers in every paragraph. No fluff.",
  "charts": [
    {
      "type": "bar|line|pie|doughnut|horizontalBar",
      "title": "Specific descriptive chart title",
      "description": "One sentence explaining what this chart reveals",
      "labels": ["label1", "label2"],
      "datasets": [
        { "label": "series name", "data": [number, number] }
      ]
    }
  ],
  "deepAnalysis": "HTML string. 5-7 paragraphs with <h3> section headers. Cover: distribution analysis, outliers, correlations, segment performance, risk areas, opportunity areas. Every claim backed by a number.",
  "recommendations": [
    {
      "priority": "critical|high|medium|low",
      "title": "Action-oriented title (verb + subject)",
      "text": "2-3 sentences: what to do, why (data evidence), expected impact",
      "metric": "The specific metric this impacts"
    }
  ],
  "dataQuality": {
    "score": 0-100,
    "issues": ["issue1", "issue2"],
    "strengths": ["strength1"]
  }
}

Rules:
- kpis: exactly 5-6, using real computed values from the statistics provided
- charts: 4-6 charts maximum, use REAL data values only, max 15 labels per chart
- recommendations: 5-7, ordered by priority, each tied to a specific data finding
- horizontalBar type: use for ranking/comparison charts with long labels
- For non-tabular data (PDF/text): extract themes, entities, key metrics mentioned in text
- dataQuality.score: based on completeness, consistency, null rates`;
}

app.listen(PORT, () => {
  console.log(`AXIOM server running on http://localhost:${PORT}`);
  if (!ANTHROPIC_API_KEY) console.warn('⚠ WARNING: ANTHROPIC_API_KEY not set in environment');
});
