import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- tiny .env loader (no extra dependency) ---------------------------------
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && !line.trim().startsWith('#') && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

const PORT = process.env.PORT || 3000;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const API_KEY = process.env.ANTHROPIC_API_KEY;

const DATA_DIR = path.join(__dirname, 'data', 'chats');
fs.mkdirSync(DATA_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- storage helpers ---------------------------------------------------------
const chatFile = (id) => path.join(DATA_DIR, `${id.replace(/[^a-z0-9-]/gi, '')}.json`);
const readChat = (id) => {
  const f = chatFile(id);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
};
const writeChat = (chat) => fs.writeFileSync(chatFile(chat.id), JSON.stringify(chat));

// --- Claude helpers ----------------------------------------------------------
const ANALYZE_SYSTEM = `You are an expert electrical-engineering tutor and circuit analyst.
You are given an image of a circuit (schematic, textbook figure, hand drawing or photo).
1. Read every component and every value that is given.
2. Decide which values are MISSING (marked with ?, x, a variable name, "find", or left blank), and which quantities the figure is clearly asking for.
3. Solve for them using Ohm's law, series/parallel reduction, KVL/KCL, nodal/mesh analysis, Thevenin/Norton, etc.
4. Reply with ONLY a JSON object, no markdown fences, with this exact shape:
{
  "summary": "one or two sentence description of the circuit",
  "given": [{"label": "R1", "value": "10 kΩ"}],
  "unknowns": [
    {
      "label": "I1",
      "quantity": "current through R1",
      "value": "2.5",
      "unit": "mA",
      "bbox": [x, y, w, h],
      "how": "short one-line method"
    }
  ],
  "steps": ["step 1 ...", "step 2 ..."],
  "confidence": "high" | "medium" | "low",
  "notes": "assumptions, ambiguities, or anything unreadable"
}
"bbox" is a rectangle in NORMALIZED image coordinates (each number between 0 and 1, relative to image width and height, origin top-left) that tightly surrounds the place in the image where that unknown appears (its label, "?" mark, or the component it belongs to).
If the image is not a circuit, return an empty "unknowns" list and explain in "notes".`;

const CHAT_SYSTEM = `You are an expert electrical-engineering tutor. The user has uploaded a circuit image that you already analyzed. Answer follow-up questions clearly and concisely in plain text, showing the key equations. If they ask to change a component value, re-solve and show the new results.`;

function parseDataUrl(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|gif|webp));base64,(.+)$/s.exec(dataUrl || '');
  if (!m) throw new Error('Unsupported image. Use JPEG, PNG, GIF or WebP data.');
  return { media_type: m[1], data: m[2] };
}

async function callClaude({ system, messages, max_tokens = 2500 }) {
  if (!API_KEY) throw new Error('ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model: MODEL, max_tokens, system, messages }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message || `Claude API error (${res.status})`);
  return body.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('The model did not return a readable solution.');
  return JSON.parse(text.slice(start, end + 1));
}

function cleanAnalysis(a) {
  const clamp = (n) => Math.min(1, Math.max(0, Number(n) || 0));
  a.given = Array.isArray(a.given) ? a.given : [];
  a.steps = Array.isArray(a.steps) ? a.steps : [];
  a.unknowns = (Array.isArray(a.unknowns) ? a.unknowns : []).map((u) => {
    const b = Array.isArray(u.bbox) && u.bbox.length === 4 ? u.bbox.map(clamp) : null;
    return { ...u, bbox: b };
  });
  return a;
}

// --- routes ------------------------------------------------------------------
app.get('/api/chats', (_req, res) => {
  const list = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')))
    .map(({ id, title, createdAt, thumb }) => ({ id, title, createdAt, thumb }))
    .sort((a, b) => b.createdAt - a.createdAt);
  res.json(list);
});

app.get('/api/chats/:id', (req, res) => {
  const chat = readChat(req.params.id);
  chat ? res.json(chat) : res.status(404).json({ error: 'Chat not found' });
});

app.delete('/api/chats/:id', (req, res) => {
  const f = chatFile(req.params.id);
  if (fs.existsSync(f)) fs.unlinkSync(f);
  res.json({ ok: true });
});

// Analyze a new circuit image -> creates a chat
app.post('/api/analyze', async (req, res) => {
  try {
    const { image, thumb } = req.body;
    const img = parseDataUrl(image);
    const text = await callClaude({
      system: ANALYZE_SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', ...img } },
            { type: 'text', text: 'Find the missing values in this circuit and solve for them.' },
          ],
        },
      ],
    });
    const analysis = cleanAnalysis(extractJson(text));
    const chat = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      title: (analysis.summary || 'Circuit').slice(0, 60),
      image,
      thumb: thumb || null,
      analysis,
      messages: [], // follow-up Q&A only; the initial analysis lives in `analysis`
    };
    writeChat(chat);
    res.json(chat);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Follow-up question inside an existing chat
app.post('/api/chats/:id/messages', async (req, res) => {
  try {
    const chat = readChat(req.params.id);
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    const text = String(req.body.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Empty message' });

    const img = parseDataUrl(chat.image);
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', ...img } },
          { type: 'text', text: 'Find the missing values in this circuit and solve for them.' },
        ],
      },
      { role: 'assistant', content: JSON.stringify(chat.analysis) },
      ...chat.messages.map((m) => ({ role: m.role, content: m.text })),
      { role: 'user', content: text },
    ];
    const reply = await callClaude({ system: CHAT_SYSTEM, messages, max_tokens: 1500 });
    chat.messages.push({ role: 'user', text }, { role: 'assistant', text: reply });
    writeChat(chat);
    res.json(chat);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Circuit Solver running at http://localhost:${PORT}`);
  if (!API_KEY) console.warn('⚠  ANTHROPIC_API_KEY is not set — copy .env.example to .env first.');
});
