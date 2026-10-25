require('dotenv').config();
const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const Groq = require('groq-sdk');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const morgan = require('morgan');

const app = express();
const port = process.env.PORT || 3001;

/* ---------------- Security & logging ---------------- */
app.use(helmet());
app.use(morgan('dev'));

/* ---------------- Rate limiting ---------------- */
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later'
});
app.use(limiter);

/* ============================================================
   CORS
   ============================================================ */
const DEFAULT_ALLOWED_ORIGINS = [
  'https://skillsyncai-client.vercel.app', // production frontend
  'http://localhost:3000',                 // CRA / Next dev
  'http://localhost:5173',                 // Vite dev
  'http://localhost:3001'                  // same-origin dev
];

const normalizeOrigin = (o) => String(o).trim().replace(/\/+$/, '');

const allowedOrigins = (
  process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : DEFAULT_ALLOWED_ORIGINS
)
  .map(normalizeOrigin)
  .filter(Boolean);

// Matches https://skillsyncai-client.vercel.app and any Vercel preview
// e.g. https://skillsyncai-client-git-main-user.vercel.app
const VERCEL_PREVIEW_RE = /^https:\/\/skillsyncai-client[a-z0-9-]*\.vercel\.app$/i;

const corsOptions = {
  origin(origin, callback) {
    // No Origin header → curl, health checks, server-to-server, same-origin
    if (!origin) return callback(null, true);

    const normalized = normalizeOrigin(origin);

    if (allowedOrigins.includes(normalized)) return callback(null, true);
    if (VERCEL_PREVIEW_RE.test(normalized)) return callback(null, true);

    console.warn('[cors] blocked origin:', origin);
    return callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
// Must reuse the SAME options — a bare cors() here would re-allow every origin.
app.options('*', cors(corsOptions));

/* ---------------- Body parsers ---------------- */
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

/* ---------------- File upload ---------------- */
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'), false);
  }
});

/* ---------------- Groq client ---------------- */
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

/* ---------------- Health / test ---------------- */
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version
  });
});

app.get('/api/test', (req, res) => {
  res.status(200).json({
    message: 'API is working',
    environment: process.env.NODE_ENV || 'development'
  });
});

/* ---------------- PDF text extraction ---------------- */
async function extractTextFromPDF(buffer) {
  try {
    const data = await pdfParse(buffer);
    return data.text;
  } catch (err) {
    console.error('PDF parsing error:', err);
    throw new Error('Failed to parse PDF');
  }
}

/* ---------------- Score helpers ---------------- */
function extractMatchScore(analysisText) {
  if (!analysisText || typeof analysisText !== 'string') return null;

  // 1) Preferred: explicit machine-readable marker
  const marker = analysisText.match(/MATCH_SCORE_PERCENT\s*=\s*(\d{1,3})/i);
  if (marker) {
    const n = parseInt(marker[1], 10);
    if (Number.isFinite(n) && n >= 0 && n <= 100) return n;
  }

  // 2) Strip HTML then try common phrasings
  const plain = analysisText
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ');

  const patterns = [
    /match\s*(?:percentage|score)\s*(?:\([^)]*\))?\s*[:\-–—]?\s*(\d{1,3})\s*%/i,
    /overall\s*(?:match|score)\s*[:\-–—]?\s*(\d{1,3})\s*%/i,
    /(\d{1,3})\s*%\s*(?:overall\s*)?match/i,
    /(\d{1,3})\s*%\s*match\s*(?:score|percentage)?/i
  ];

  for (const re of patterns) {
    const m = plain.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n >= 0 && n <= 100) return n;
    }
  }
  return null;
}

function stripScoreMarker(text) {
  if (!text) return text;
  return text
    .replace(/^[ \t]*MATCH_SCORE_PERCENT\s*=\s*\d{1,3}[ \t]*$/gim, '')
    .trim();
}

/* ---------------- Analyze endpoint ---------------- */
app.post('/api/analyze', upload.single('resume'), async (req, res) => {
  console.log('Analysis request received');

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No resume file uploaded' });
    }

    const jobDescription = req.body.jobDescription;
    if (!jobDescription || jobDescription.trim().length < 20) {
      return res.status(400).json({
        error: 'Valid job description is required (minimum 20 characters)'
      });
    }

    console.log('Extracting text from PDF...');
    const resumeText = await extractTextFromPDF(req.file.buffer);
    if (!resumeText || resumeText.trim().length < 50) {
      return res.status(400).json({ error: 'Resume appears to be empty or too short' });
    }

    const prompt = `
    Analyze the following resume against the provided job description and provide a detailed assessment.

    RESUME CONTENT:
    ${resumeText.substring(0, 10000)} ${resumeText.length > 10000 ? '[content truncated]' : ''}

    JOB DESCRIPTION:
    ${jobDescription.substring(0, 5000)} ${jobDescription.length > 5000 ? '[content truncated]' : ''}

    ANALYSIS REQUIREMENTS:
    1. Calculate a Match Percentage (0-100%) based on skills, experience, and qualifications
    2. List the top 5 matching skills with relevance indicators
    3. Identify missing qualifications with severity level (critical, important, nice-to-have)
    4. Provide specific improvement suggestions for better alignment
    5. Offer a final recommendation (Strong Match, Potential Match, Needs Improvement, Not Suitable)
    6. Include a strengths and weaknesses summary

    FORMAT REQUIREMENTS:
    - Use HTML formatting with semantic structure
    - Include headings for each section
    - Use bullet points for lists
    - Highlight key metrics (like match percentage) with <strong> tags
    - Ensure the response is professional and constructive

    OUTPUT CONTRACT (MANDATORY):
    - After your HTML analysis, on its own final line, output exactly:
      MATCH_SCORE_PERCENT=<integer 0-100>
    - Do not wrap that final line in HTML tags.
    - Example: MATCH_SCORE_PERCENT=78
    `;

    console.log('Sending request to Groq AI (qwen/qwen3.8-27b)...');

    const completion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'qwen/qwen3.8-27b',
      max_completion_tokens: 2000,
      temperature: 0.6,
      top_p: 0.95,
      reasoning_effort: 'default'
    });

    const rawAnalysis = completion.choices[0]?.message?.content || '';
    const analysisResult = stripScoreMarker(rawAnalysis);
    const matchScore = extractMatchScore(rawAnalysis);

    console.log('Analysis completed. Score:', matchScore);

    res.status(200).json({
      success: true,
      result: analysisResult,
      matchScore,
      analyzedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Analysis error:', error);

    const errorResponse = {
      error: 'Failed to analyze resume',
      details: error.message
    };
    if (process.env.NODE_ENV === 'development') {
      errorResponse.stack = error.stack;
    }
    res.status(500).json(errorResponse);
  }
});

/* ---------------- Error handling ---------------- */
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message
  });
});

/* ---------------- Start ---------------- */
app.listen(port, () => {
  const serverInfo = `
  ╔═══════════════════════════════════════════════════╗
  ║                                                   ║
  ║   Resume Analyzer API v${process.env.npm_package_version || '1.0.0'}             ║
  ║                                                   ║
  ║   Port: ${port.toString().padEnd(36)}║
  ║   Environment: ${(process.env.NODE_ENV || 'development').padEnd(25)}║
  ║   Model: qwen/qwen3.8-27b                         ║
  ║                                                   ║
  ╚═══════════════════════════════════════════════════╝
  `;
  console.log(serverInfo);
  console.log(`Access the API at http://localhost:${port}/api/health`);
  console.log('Allowed CORS origins:', allowedOrigins.join(', '));
});
