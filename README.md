# AXIOM · Intelligent Data Reports

Upload any data file → Get a full professional report with AI insights, KPIs, and visualizations.

## Supports
- **CSV / TSV / TXT** — tabular delimited data
- **XLSX / XLS** — Excel spreadsheets (first sheet)
- **JSON** — arrays or objects
- **PDF** — text extraction + AI analysis

## What the report includes
1. **KPI Cards** — 5–6 key metrics with trend indicators
2. **Executive Summary** — AI-written, data-backed overview
3. **5 Dynamic Charts** — bar, line, pie, doughnut, horizontal bar
4. **Deep Analysis** — patterns, outliers, correlations, risks
5. **Recommendations** — prioritized action plan (Critical → Low)
6. **Data Preview** — first 20 rows of your dataset
7. **Data Quality Score** — completeness + consistency assessment

---

## Setup & Run Locally

### 1. Install dependencies
```bash
npm install
```

### 2. Configure your API key
```bash
cp .env.example .env
```
Edit `.env` and add your Anthropic API key:
```
ANTHROPIC_API_KEY=sk-ant-api03-YOUR_KEY_HERE
PORT=3000
```

### 3. Start the server
```bash
npm start
```

Open **http://localhost:3000** in your browser.

---

## Deploy to Railway (Recommended — Free)

1. Go to **https://railway.app** → New Project → Deploy from GitHub
2. Connect your GitHub repo (push this folder to a new repo first)
3. In Railway dashboard → Variables → Add:
   - `ANTHROPIC_API_KEY` = your key
   - `PORT` = 3000
4. Railway auto-detects Node.js and deploys. You get a public URL.

## Deploy to Render (Free)

1. Go to **https://render.com** → New Web Service
2. Connect GitHub repo
3. Build command: `npm install`
4. Start command: `npm start`
5. Add environment variable: `ANTHROPIC_API_KEY`

## Deploy to any VPS (DigitalOcean, etc.)

```bash
git clone <your-repo>
cd axiom-app
npm install
cp .env.example .env
nano .env  # add your API key
npm start
```
Use PM2 for production:
```bash
npm install -g pm2
pm2 start server.js --name axiom
pm2 save
```

---

## File Structure
```
axiom-app/
├── server.js          # Express backend + API proxy
├── public/
│   └── index.html     # Full frontend (single page)
├── .env.example       # Environment template
├── package.json
└── README.md
```

## Cost per Report
- Uses Claude claude-opus-4-5 → ~$0.03–0.08 per report depending on file size
- Small CSV (100 rows): ~$0.02
- Large Excel (10,000 rows): ~$0.06

## Notes
- Files are parsed in-memory. Nothing is saved to disk.
- Max file size: 50MB
- For very large files (100k+ rows), the system samples intelligently
