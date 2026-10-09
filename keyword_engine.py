"""Find labeled data across source documents and resolve template placeholders."""

from __future__ import annotations

import re
from pathlib import Path

from document_data import SPREADSHEET_TYPES, column_label, read_spreadsheet

PLACEHOLDER = re.compile(r"\{\{\s*([^{}:]+?)\s*(?::(first|last|count))?\s*\}\}")


def clean_key(value: str) -> str:
    return value.strip().rstrip(":：=").strip().casefold()


def parse_keywords(values: list[str]) -> list[str]:
    if not isinstance(values, list) or any(not isinstance(value, str) for value in values):
        raise ValueError("keyword ต้องเป็นรายการข้อความ")
    found: dict[str, str] = {}
    for value in values:
        key = value.strip()
        if key and clean_key(key) not in found:
            found[clean_key(key)] = key
    if not found:
        raise ValueError("กรุณาระบุ keyword อย่างน้อยหนึ่งรายการ")
    return list(found.values())


def make_hit(keyword: str, value: str, filename: str, location: str) -> dict:
    return {"keyword": keyword, "value": value.strip(), "source": filename, "location": location}


def text_hits(filename: str, content: str, keywords: list[str]) -> list[dict]:
    canonical = {clean_key(key): key for key in parse_keywords(keywords)}
    patterns = [(key, re.compile(r"^\s*" + re.escape(key) + r"\s*[:：=\t,]\s*(.*)$", re.IGNORECASE))
                for key in sorted(canonical.values(), key=len, reverse=True)]
    lines = content.splitlines()
    hits: list[dict] = []
    for index, line in enumerate(lines):
        keyword = canonical.get(clean_key(line))
        inline_value = ""
        if keyword is None:
            for candidate, pattern in patterns:
                match = pattern.match(line)
                if match:
                    keyword, inline_value = candidate, match.group(1).strip()
                    break
        if keyword is None:
            continue
        value = inline_value
        if not value:
            for next_line in lines[index + 1:index + 4]:
                if next_line.strip():
                    candidate = next_line.strip()
                    if clean_key(candidate) not in canonical and not any(pattern.match(candidate) for _, pattern in patterns):
                        value = candidate
                    break
        if value:
            hits.append(make_hit(keyword, value, filename, f"บรรทัด {index + 1}"))
    return hits


def spreadsheet_hits(filename: str, data: bytes, keywords: list[str]) -> list[dict]:
    canonical = {clean_key(key): key for key in parse_keywords(keywords)}
    _, cells = read_spreadsheet(filename, data)
    hits: list[dict] = []
    for (sheet, row, column), text in sorted(cells.items()):
        keyword = canonical.get(clean_key(text))
        value = ""
        if keyword is None:
            for candidate in canonical.values():
                match = re.match(r"^\s*" + re.escape(candidate) + r"\s*[:：=]\s*(.+)$", text, re.IGNORECASE)
                if match:
                    keyword, value = candidate, match.group(1).strip()
                    break
        if keyword is None:
            continue
        if not value:
            right = cells.get((sheet, row, column + 1), "")
            below = cells.get((sheet, row + 1, column), "")
            value = right if right and clean_key(right) not in canonical else below
        if value:
            hits.append(make_hit(keyword, value, filename, f"{sheet}!{column_label(column)}{row}"))
    return hits


def extract_hits(filename: str, data: bytes, keywords: list[str], text_reader) -> list[dict]:
    if Path(filename).suffix.lower() in SPREADSHEET_TYPES:
        return spreadsheet_hits(filename, data, keywords)
    return text_hits(filename, text_reader(filename, data), keywords)


def value_map(raw: dict) -> dict[str, list[str]]:
    if not isinstance(raw, dict):
        raise ValueError("รูปแบบข้อมูล keyword ไม่ถูกต้อง")
    values: dict[str, list[str]] = {}
    for keyword, entries in raw.items():
        if not isinstance(keyword, str) or not isinstance(entries, list):
            raise ValueError("รูปแบบข้อมูล keyword ไม่ถูกต้อง")
        items = []
        for entry in entries:
            value = entry.get("value", "") if isinstance(entry, dict) else entry
            if not isinstance(value, str):
                raise ValueError("ค่า keyword ต้องเป็นข้อความ")
            if value:
                items.append(value)
        values[clean_key(keyword)] = items
    return values


def substitute(text: str, raw_values: dict) -> str:
    values = value_map(raw_values)

    def replace(match: re.Match) -> str:
        key, option = clean_key(match.group(1)), match.group(2)
        if key not in values:
            return match.group(0)
        entries = values[key]
        if option == "count":
            return str(len(entries))
        if not entries:
            return match.group(0)
        if option == "first":
            return entries[0]
        if option == "last":
            return entries[-1]
        return "\n".join(entries)

    return PLACEHOLDER.sub(replace, text)


def missing_placeholders(text: str, raw_values: dict) -> list[str]:
    values = value_map(raw_values)
    return sorted({match.group(1).strip() for match in PLACEHOLDER.finditer(text)
                   if not values.get(clean_key(match.group(1)))})
