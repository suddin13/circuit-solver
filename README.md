# Circuit Solver

Drop in a picture of a circuit. The app finds the missing values, solves them, and shows
your image with the answers highlighted next to the prompt. Past circuits are kept in a
collapsible history sidebar.

## Run it

1. Install [Node.js](https://nodejs.org) 18 or newer.
2. In this folder:
   ```bash
   npm install
   cp .env.example .env     # then put your Anthropic API key in .env
   npm start
   ```
3. Open http://localhost:3000

## Using it

- **Add a circuit**: drag & drop an image onto the dashboard, paste with Ctrl/⌘+V, or click to browse.
  Any image your browser can decode works (PNG, JPG, GIF, WebP, BMP, SVG…); it is converted automatically.
- **Solution panel** (right): your image with highlighted answers, a numbered legend, and a "Show work" section.
- **Follow-ups**: ask questions under the image ("what if R2 doubles?").
- **History**: click the ☰ button (top-left) to open the sidebar. Click any past panel to reopen its
  image, solution and chat. ✕ deletes one.
- **Download image** saves the highlighted result as a PNG.

## Files

- `server.js` – Express server; calls Claude's vision API; stores each chat as JSON in `data/chats/`
- `public/` – dashboard UI (`index.html`, `styles.css`, `app.js`)

## Notes

- Your API key stays on the server (`.env`); the browser never sees it.
- Highlight positions are estimated by the model, so a box can occasionally sit slightly off.
  Check the numbered legend and "Show work" for the actual values and method.
- Set `ANTHROPIC_MODEL` in `.env` to use a different Claude model.
