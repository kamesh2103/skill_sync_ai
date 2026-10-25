/* ============================================================
   ResumeMatch AI — frontend controller
   ============================================================ */

/* ---------- API base (auto-detect local :3001) ---------- */
const API_BASE = (() => {
  const { protocol, hostname, port, origin } = window.location;
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
  if (isLocal && port && port !== '3001') return `${protocol}//${hostname}:3001`;
  return origin;
})();

/* ---------- DOM ---------- */
const form             = document.getElementById('analyzerForm');
const fileInput        = document.getElementById('resumeFile');
const uploadWrapper    = document.getElementById('fileUploadWrapper');
const fileInfo         = document.getElementById('fileInfo');
const fileNameEl       = fileInfo.querySelector('.file-name');
const fileSizeEl       = fileInfo.querySelector('.file-size');
const jobDescription   = document.getElementById('jobDescription');
const charCount        = document.getElementById('charCount');
const loadingContainer = document.getElementById('loadingContainer');
const resultsContainer = document.getElementById('resultsContainer');
const resultsContent   = document.getElementById('resultsContent');
const matchScoreWrap   = document.getElementById('matchScoreWrap');
const matchScoreEl     = document.getElementById('matchScore');

/* ---------- State ---------- */
let selectedFile = null;
let isBusy = false;

/* ============================================================
   FILE HANDLING
   ============================================================ */
uploadWrapper.addEventListener('click', () => fileInput.click());
uploadWrapper.setAttribute('tabindex', '0');
uploadWrapper.setAttribute('role', 'button');
uploadWrapper.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
});

['dragenter', 'dragover'].forEach((ev) =>
  uploadWrapper.addEventListener(ev, (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadWrapper.classList.add('dragover');
  })
);

['dragleave', 'drop'].forEach((ev) =>
  uploadWrapper.addEventListener(ev, (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadWrapper.classList.remove('dragover');
  })
);

uploadWrapper.addEventListener('drop', (e) => {
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) setFile(f);
});

fileInput.addEventListener('change', (e) => {
  const f = e.target.files && e.target.files[0];
  if (f) setFile(f);
});

function setFile(file) {
  if (file.type !== 'application/pdf') {
    return showError('Only PDF files are allowed.');
  }
  if (file.size > 5 * 1024 * 1024) {
    return showError('File is too large. Maximum size is 5 MB.');
  }
  selectedFile = file;
  fileNameEl.textContent = file.name;
  fileSizeEl.textContent = formatBytes(file.size);
  fileInfo.classList.add('show');
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

/* ============================================================
   CHARACTER COUNT
   ============================================================ */
jobDescription.addEventListener('input', () => {
  charCount.textContent = jobDescription.value.length;
});

/* ============================================================
   SUBMIT
   ============================================================ */
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (isBusy) return;

  if (!selectedFile) return showError('Please upload a PDF resume first.');
  if (jobDescription.value.trim().length < 20) {
    return showError('Job description must be at least 20 characters.');
  }

  const body = new FormData();
  body.append('resume', selectedFile);
  body.append('jobDescription', jobDescription.value.trim());

  setBusy(true);
  loadingContainer.classList.add('show');
  resultsContainer.classList.remove('show');

  try {
    const res = await fetch(API_BASE + '/api/analyze', { method: 'POST', body });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.details || data.error || ('Request failed (' + res.status + ')'));
    }

    const score = coerceScore(data.matchScore, data.result);
    renderScore(score);

    const rawResult = typeof data.result === 'string' ? data.result : '';
    resultsContent.innerHTML = looksLikeHtml(rawResult)
      ? sanitizeHtml(rawResult)
      : markdownToHtml(rawResult);

    resultsContainer.classList.add('show');
    resultsContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    console.error('[analyze]', err);
    showError(err.message || 'Something went wrong while analyzing the resume.');
  } finally {
    loadingContainer.classList.remove('show');
    setBusy(false);
  }
});

function setBusy(busy) {
  isBusy = busy;
  const btn = form.querySelector('.analyze-btn');
  if (btn) btn.disabled = busy;
}

/* ============================================================
   SCORE — coerce, render, animate
   ============================================================ */
function coerceScore(raw, text) {
  // 1) Numeric from server
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0 && n <= 100) return Math.round(n);

  // 2) Fallback: parse from returned text
  if (typeof text === 'string' && text.length) {
    const plain = text.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ');

    const marker = plain.match(/MATCH_SCORE_PERCENT\s*=\s*(\d{1,3})/i);
    if (marker) {
      const v = parseInt(marker[1], 10);
      if (v >= 0 && v <= 100) return v;
    }

    const patterns = [
      /match\s*(?:percentage|score)\s*(?:\([^)]*\))?\s*[:\-–—]?\s*(\d{1,3})\s*%/i,
      /overall\s*(?:match|score)\s*[:\-–—]?\s*(\d{1,3})\s*%/i,
      /(\d{1,3})\s*%\s*(?:overall\s*)?match/i
    ];
    for (const re of patterns) {
      const m = plain.match(re);
      if (m) {
        const v = parseInt(m[1], 10);
        if (v >= 0 && v <= 100) return v;
      }
    }
  }

  return null;
}

function renderScore(score) {
  matchScoreWrap.classList.remove('no-score');

  if (score === null || score === undefined) {
    matchScoreWrap.classList.add('no-score');
    matchScoreEl.textContent = 'N/A';
    return;
  }

  // Animated count-up 0 -> score
  const duration = 900;
  const start = performance.now();

  function tick(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    matchScoreEl.textContent = Math.round(score * eased);
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/* ============================================================
   RESULT NORMALIZATION
   ============================================================ */
function looksLikeHtml(s) {
  return /<\s*(h[1-6]|p|ul|ol|li|table|div|section|strong|em|br|span)\b/i.test(s);
}

function sanitizeHtml(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"');
}

function markdownToHtml(md) {
  if (!md) return '';
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let html = '';
  let listType = null;

  const closeList = () => {
    if (listType) { html += '</' + listType + '>'; listType = null; }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { closeList(); continue; }

    let m;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      closeList();
      const lvl = m[1].length;
      html += '<h' + lvl + '>' + inline(m[2]) + '</h' + lvl + '>';
      continue;
    }
    if ((m = line.match(/^[-*+]\s+(.*)$/))) {
      if (listType !== 'ul') { closeList(); html += '<ul>'; listType = 'ul'; }
      html += '<li>' + inline(m[1]) + '</li>';
      continue;
    }
    if ((m = line.match(/^\d+\.\s+(.*)$/))) {
      if (listType !== 'ol') { closeList(); html += '<ol>'; listType = 'ol'; }
      html += '<li>' + inline(m[1]) + '</li>';
      continue;
    }
    closeList();
    html += '<p>' + inline(line) + '</p>';
  }
  closeList();
  return html;
}

function inline(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

/* ============================================================
   ERROR TOAST
   ============================================================ */
function showError(message) {
  const existing = document.querySelector('.error-message');
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.className = 'error-message';
  el.setAttribute('role', 'alert');
  el.textContent = message;
  document.body.appendChild(el);

  setTimeout(() => {
    el.style.animation = 'slideOutUp 0.3s ease-in forwards';
    setTimeout(() => el.remove(), 320);
  }, 4200);
}