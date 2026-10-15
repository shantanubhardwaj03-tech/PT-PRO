# ChillCheck

Free superheat/subcool calculator, refrigerant PT chart, and service manual finder for HVAC and refrigeration techs. Works offline on phones.

## What's in it
- **Charge check**: superheat, subcool, piston target superheat (AC), evaporator TD (refrigeration)
- **PT chart**: 13 refrigerants, bubble and dew for blends, vacuum in inHg
- **Manuals**: type a model number, get direct links to wiring diagrams, install manuals, service manuals and spec sheets (PDF)

## Files
- `index.html` the whole app
- `sw.js`, `manifest.webmanifest`, `icon-*.png` offline install support
- `netlify/functions/docs.mjs` server function that finds PDFs for a model (`/api/docs?model=...`)
- `netlify.toml` Netlify settings

## Setup
1. Get a Brave Search API key (Search plan, $5 free credit each month).
2. Deploy this repo on Netlify (Import from Git).
3. In Netlify: Project configuration → Environment variables → add `BRAVE_API_KEY` with your key, then redeploy.

## Data sources
Saturation data generated from CoolProp equations of state. R-454B matched to Chemours' published Opteon XL41 table.
