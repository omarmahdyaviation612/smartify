"""Single-responsibility PDF -> PNG page renderer for the offline unit-
grounding extraction pipeline (see apps/backend/src/interactive-lesson/
unit-grounding/unit-grounding.service.ts). Deliberately does nothing else:
no AI calls, no network access, no database access. Ingestion artifact
only -- the caller is responsible for deleting the output images once
extraction is done; they must never become part of the student-facing
application (no public/static dir, no student API exposure).

Usage:
    python render_pdf_pages.py <pdf_path> <start_page> <end_page> <out_dir>

<start_page>/<end_page> are 1-based and inclusive, matching how page
numbers are recorded in curriculum-pilot/toc-manifests/*.json and on the
Unit.sourcePageStart/sourcePageEnd columns. Writes page-<n>.png into
<out_dir> for each page in range and prints the written file paths, one
per line, to stdout on success. Non-zero exit code + a message on stderr
on any failure (bad path, out-of-range page, etc.) -- never partially
written output is silently treated as success by the caller.
"""

import sys
import os

import pymupdf


def render_pdf_pages(pdf_path: str, start_page: int, end_page: int, out_dir: str) -> list[str]:
    if not os.path.isfile(pdf_path):
        raise FileNotFoundError(f"PDF not found: {pdf_path}")
    if start_page < 1 or end_page < start_page:
        raise ValueError(f"Invalid page range: {start_page}-{end_page}")

    os.makedirs(out_dir, exist_ok=True)

    doc = pymupdf.open(pdf_path)
    try:
        total_pages = len(doc)
        if end_page > total_pages:
            raise ValueError(f"end_page {end_page} exceeds document length {total_pages}")

        written: list[str] = []
        for page_number in range(start_page, end_page + 1):
            page = doc[page_number - 1]  # pymupdf pages are 0-indexed
            pixmap = page.get_pixmap(dpi=150)
            out_path = os.path.join(out_dir, f"page-{page_number}.png")
            pixmap.save(out_path)
            written.append(out_path)
        return written
    finally:
        doc.close()


def main() -> int:
    if len(sys.argv) != 5:
        print("Usage: python render_pdf_pages.py <pdf_path> <start_page> <end_page> <out_dir>", file=sys.stderr)
        return 2

    pdf_path, start_page_raw, end_page_raw, out_dir = sys.argv[1:5]
    try:
        start_page = int(start_page_raw)
        end_page = int(end_page_raw)
    except ValueError:
        print("start_page/end_page must be integers", file=sys.stderr)
        return 2

    try:
        written = render_pdf_pages(pdf_path, start_page, end_page, out_dir)
    except Exception as err:  # noqa: BLE001 - single top-level boundary, reported to stderr, never swallowed
        print(f"ERROR: {err}", file=sys.stderr)
        return 1

    for path in written:
        print(path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
