# Coin Toss (Real Toss + Sound + Provably Fair)

## Features
- 3D coin toss animation (up/down + spin + land)
- Sound effects (whoosh + clink) using WebAudio (no external files)
- Provably fair outcome using commit–reveal:
  - Before each flip: shows SHA-256(serverSeed)
  - After flip: reveals serverSeed used
  - You can verify the commit and the outcome

## Setup
1) Put your images here:
- `assets/heads.png`
- `assets/tails.png`

2) Run locally:
- Open `index.html` directly, OR (recommended):
  - `python -m http.server 8080`
  - Open: http://localhost:8080

## Deploy to GitHub Pages
- Push this repo to GitHub
- Repo Settings → Pages → Deploy from branch → `main` / root
- You’ll get a public URL
