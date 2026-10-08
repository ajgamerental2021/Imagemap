"""Local, stateless document and image comparison API."""

from __future__ import annotations

import difflib
import io
import os
import subprocess
import tempfile
from itertools import accumulate
from pathlib import Path

from docx import Document
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from openpyxl import load_workbook
from PIL import Image, ImageChops, ImageOps, UnidentifiedImageError
from pypdf import PdfReader
from starlette.concurrency import run_in_threadpool

ROOT = Path(__file__).parent
MAX_BYTES = 20 * 1024 * 1024
MAX_TEXT = 200_000
MAX_IMAGE_PIXELS = 18_000_000
IMAGE_TYPES = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff"}
TEXT_TYPES = {".txt", ".md", ".csv", ".tsv", ".json", ".xml", ".html", ".htm", ".yaml", ".yml", ".log", ".py", ".js", ".ts", ".css", ".sql"}
DOCUMENT_TYPES = {".pdf", ".docx", ".xlsx"}
SUPPORTED_TYPES = IMAGE_TYPES | TEXT_TYPES | DOCUMENT_TYPES

app = FastAPI(title="Pairwise Compare", docs_url=None, redoc_url=None)


@app.get("/")
def index():
    return FileResponse(ROOT / "static" / "index.html")


@app.get("/static/{filename}")
def static(filename: str):
    if filename not in {"app.js", "styles.css"}:
        raise HTTPException(404)
    return FileResponse(ROOT / "static" / filename)


@app.get("/api/health")
def health():
    return {"ok": True}


def kind(filename: str) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix in IMAGE_TYPES:
        return "image"
    if suffix in TEXT_TYPES | DOCUMENT_TYPES:
        return "document"
    raise ValueError(f"ไม่รองรับไฟล์ชนิด {suffix or '(ไม่มีนามสกุล)'}")


async def read_upload(upload: UploadFile) -> bytes:
    data = await upload.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("ไฟล์ใหญ่เกิน 20 MB")
    if not data:
        raise ValueError("ไฟล์ว่าง")
    return data


def extract_text(filename: str, data: bytes) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix in TEXT_TYPES:
        try:
            decoded = data.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise ValueError("ไฟล์ข้อความต้องเข้ารหัส UTF-8") from exc
        if "\x00" in decoded:
            raise ValueError("ไฟล์นี้ดูเป็นข้อมูลไบนารี ไม่ใช่ข้อความ")
        result = decoded
    elif suffix == ".pdf":
        try:
            reader = PdfReader(io.BytesIO(data))
            if len(reader.pages) > 100:
                raise ValueError("PDF มีเกิน 100 หน้า")
            result = "\n".join(page.extract_text() or "" for page in reader.pages)
        except ValueError:
            raise
        except Exception as exc:
            raise ValueError("อ่าน PDF ไม่สำเร็จ") from exc
    elif suffix == ".docx":
        try:
            doc = Document(io.BytesIO(data))
            sections = [p.text for p in doc.paragraphs]
            for table in doc.tables:
                sections.extend("\t".join(cell.text for cell in row.cells) for row in table.rows)
            result = "\n".join(sections)
        except Exception as exc:
            raise ValueError("อ่าน DOCX ไม่สำเร็จ") from exc
    elif suffix == ".xlsx":
        try:
            book = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
            sections = []
            for sheet in book:
                sections.append(f"[ชีต: {sheet.title}]")
                for row in sheet.iter_rows(values_only=True):
                    sections.append("\t".join("" if cell is None else str(cell) for cell in row))
            book.close()
            result = "\n".join(sections)
        except Exception as exc:
            raise ValueError("อ่าน XLSX ไม่สำเร็จ") from exc
    else:
        raise ValueError("ไม่รองรับชนิดเอกสารนี้")
    if len(result) > MAX_TEXT:
        raise ValueError("ข้อความที่ดึงได้ยาวเกิน 200,000 ตัวอักษร")
    return result


def load_image(data: bytes) -> Image.Image:
    try:
        image = Image.open(io.BytesIO(data))
        if image.width * image.height > MAX_IMAGE_PIXELS:
            raise ValueError("รูปมีพิกเซลมากเกิน 18 ล้านพิกเซล")
        return ImageOps.exif_transpose(image).convert("RGBA")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ValueError("อ่านรูปไม่สำเร็จ") from exc


def ocr_image(image: Image.Image) -> str | None:
    """Return None if OCR is unavailable, and text (possibly empty) otherwise."""
    with tempfile.TemporaryDirectory() as directory:
        source = Path(directory) / "image.png"
        image.convert("RGB").save(source)
        try:
            environment = os.environ.copy()
            tessdata = ROOT / ".local" / "tessdata"
            if (tessdata / "tha.traineddata").is_file():
                environment["TESSDATA_PREFIX"] = str(tessdata)
            langs = subprocess.run(
                ["tesseract", "--list-langs"], capture_output=True, text=True, timeout=5, check=True, env=environment
            ).stdout
            language = "tha+eng" if "tha" in langs.splitlines() else "eng"
            completed = subprocess.run(
                ["tesseract", str(source), "stdout", "-l", language],
                capture_output=True, text=True, timeout=30, check=True, env=environment,
            )
            return completed.stdout.strip()
        except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
            return None


def visual_difference(left: Image.Image, right: Image.Image) -> dict:
    if left.size != right.size:
        return {"same": False, "left_size": list(left.size), "right_size": list(right.size), "changed_pixels": None}
    delta = ImageChops.difference(left, right)
    channels = delta.split()
    mask = channels[0]
    for channel in channels[1:]:
        mask = ImageChops.lighter(mask, channel)
    changed = mask.point(lambda value: 255 if value else 0).histogram()[255]
    return {"same": changed == 0, "left_size": list(left.size), "right_size": list(right.size), "changed_pixels": changed}


def position(value: str, offset: int) -> dict:
    return {"line": value.count("\n", 0, offset) + 1, "column": offset - value.rfind("\n", 0, offset)}


def text_difference(left: str, right: str) -> dict:
    if left == right:
        return {"same": True, "left_characters": len(left), "right_characters": len(right), "changes": []}
    # A full character diff can stall on large documents. First align lines, then
    # refine short changed blocks at character level. Equality checks all text.
    limited = False
    if max(len(left), len(right)) <= 3_000:
        operations = [op for op in difflib.SequenceMatcher(None, left, right, autojunk=False).get_opcodes() if op[0] != "equal"]
    else:
        left_lines, right_lines = left.splitlines(keepends=True), right.splitlines(keepends=True)
        if max(len(left_lines), len(right_lines)) <= 2_000:
            left_offsets = [0, *accumulate(map(len, left_lines))]
            right_offsets = [0, *accumulate(map(len, right_lines))]
            line_ops = (op for op in difflib.SequenceMatcher(
                None, left_lines, right_lines, autojunk=False
            ).get_opcodes() if op[0] != "equal")
            operations = []
            for tag, i, j, k, l in line_ops:
                a, b, c, d = left_offsets[i], left_offsets[j], right_offsets[k], right_offsets[l]
                if max(b - a, d - c) <= 3_000:
                    operations.extend((part_tag, a + pi, a + pj, c + pk, c + pl)
                        for part_tag, pi, pj, pk, pl in difflib.SequenceMatcher(
                            None, left[a:b], right[c:d], autojunk=False
                        ).get_opcodes() if part_tag != "equal")
                else:
                    operations.append((tag, a, b, c, d))
                    limited = True
                if len(operations) > 30:
                    limited = True
                    break
        else:
            prefix = 0
            while prefix < min(len(left), len(right)) and left[prefix] == right[prefix]:
                prefix += 1
            suffix = 0
            while (suffix < min(len(left), len(right)) - prefix and left[-1 - suffix] == right[-1 - suffix]):
                suffix += 1
            operations = [("replace", prefix, len(left) - suffix, prefix, len(right) - suffix)]
            limited = True
    changes = []
    for _, i, j, k, l in operations[:30]:
        changes.append({
            "left_at": position(left, i), "right_at": position(right, k),
            "before": left[max(0, i - 60):i],
            "left": left[i:min(j, i + 240)], "right": right[k:min(l, k + 240)],
            "after": left[j:min(len(left), j + 60)],
            "left_truncated": j - i > 240, "right_truncated": l - k > 240,
        })
    return {"same": False, "left_characters": len(left), "right_characters": len(right),
            "changes": changes, "preview_limited": limited or len(operations) > 30}


@app.post("/api/compare")
async def compare(left: UploadFile = File(...), right: UploadFile = File(...)):
    try:
        left_kind, right_kind = kind(left.filename or ""), kind(right.filename or "")
        left_data, right_data = await read_upload(left), await read_upload(right)
        return await run_in_threadpool(
            compare_bytes, left.filename or "", left_data, left_kind,
            right.filename or "", right_data, right_kind,
        )
    except ValueError as exc:
        raise HTTPException(422, detail=str(exc)) from exc


def compare_bytes(left_name: str, left_data: bytes, left_kind: str,
                  right_name: str, right_data: bytes, right_kind: str) -> dict:
    """Run parsing and OCR off the async event loop so pairs can progress together."""
    try:
        left_image = load_image(left_data) if left_kind == "image" else None
        right_image = load_image(right_data) if right_kind == "image" else None
        visual = visual_difference(left_image, right_image) if left_image and right_image else None
        left_text = ocr_image(left_image) if left_image else extract_text(left_name, left_data)
        right_text = ocr_image(right_image) if right_image else extract_text(right_name, right_data)
        text = text_difference(left_text, right_text) if left_text is not None and right_text is not None else None
        if visual and visual["same"]:
            status = "completed"
        elif visual:
            status = "different"
        elif left_kind == right_kind == "document" and left_data == right_data:
            status = "completed"
        elif text is None or ((left_image or right_image) and not (left_text or right_text)):
            status = "inconclusive"
        elif not left_text and not right_text:
            status = "inconclusive"
        elif text["same"]:
            status = "matched_ocr" if left_image or right_image else "completed"
        else:
            status = "different"
        return {"status": status, "left_kind": left_kind, "right_kind": right_kind,
                "visual": visual, "text": text, "ocr_available": (left_text is not None and right_text is not None),
                "ocr_language": "tha+eng" if left_image or right_image else None}
    except ValueError as exc:
        raise HTTPException(422, detail=str(exc)) from exc
