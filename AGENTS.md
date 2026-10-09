# Compare Studio — handoff for another AI chat

This repository contains the working FastAPI web app for pairwise comparison and keyword driven document generation. The active deployment branch is `compare-studio-deploy`. Read `README.md` and `docs/TEMPLATE_GUIDE.md` first. User requests and conversation context override this handoff.

## User goals

- Compare 1:1 pairs of documents/images, many pairs per batch. Show exact spreadsheet cells and text line/column differences, plus full CSV difference report. In browser folder mode, match identical paths first, then pair remaining files by natural filename order; show the pair list with editable right-side selection. Local path mode supports auto/name/order strategies too.
- Support `.xls`, `.xlsx`, `.xlsm`, `.xlsb`, DOCX, text formats, text and scanned PDFs, and images with OCR. PDF scan pages are rasterized with pypdfium2 and OCR'd with Tesseract (up to 30 scanned pages per PDF). When both sources are PDFs, scanned pages are also compared as pixels and reported by page/bounding box, including when OCR is unavailable. Byte-identical PDFs return completed before OCR. `/api/ocr/status` diagnoses Tesseract availability on the running service. Never claim OCR equality is exact source equality.
- Provide both browser upload and direct local path mode. The latter only works when the FastAPI server runs on the same machine as the files, started with `LOCAL_FOLDER_ACCESS=1`, with the browser opening it on loopback. On macOS the path mode offers a native Finder folder chooser via AppleScript. Render cannot read a user's Mac folder directly.
- Find user supplied keyword labels across any number of source files. Aggregate all values for each keyword with source/location provenance, allow edits in the UI, and fill a DOCX/XLSX/PDF output from a web designed template or an uploaded template.

## Code map

- `app.py`: FastAPI routes, text/OCR/image extraction, compare/report/local and generation endpoints. Upload limit 20 MB/file; files handled in memory during requests.
- `document_data.py`: Excel parsers and per-cell comparison with exact positions.
- `keyword_engine.py`: label/value extraction and `{{keyword}}` substitution (`first`, `last`, `count`).
- `generation.py`: web template rendering to DOCX/XLSX/PDF; uploaded DOCX/XLSX/XLSM placeholder filling and fillable PDF form fields. Thai PDF font files and license are in `assets/`.
- `static/index.html`, `app.js`, `generator.js`, `styles.css`: browser UI.
- `tests/test_compare.py`, `tests/test_generation.py`: integration tests.
- `Dockerfile`, `render.yaml`: Render deployment; `requirements.txt`: pinned Python packages.

## Run and verify

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m unittest discover -s tests -v
LOCAL_FOLDER_ACCESS=1 .venv/bin/uvicorn app:app --host 127.0.0.1 --port 8000
```

Omit `LOCAL_FOLDER_ACCESS=1` on Render. Install `tesseract-ocr` and `tesseract-ocr-tha` for OCR. Uploaded template formats are DOCX/XLSX/XLSM and *fillable* PDF; the web designer exports DOCX/XLSX/PDF. Any supported source file type can feed them. OCR, source parsing, and template layout have the limitations described in the guide. Do not expose direct path reading on a public host.

## Continuation note

When changing behavior, update README/guide and integration tests, then deploy via the `compare-studio-deploy` branch. A public Render URL requires the repository owner to connect their GitHub account to Render and create the web service. A cloud development localhost URL is only reachable inside that environment.
