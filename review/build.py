"""Build review/Idea01_Review.html: bundles project docs + offline libraries + saved reviews.

Usage:  python review/build.py
Re-run after any doc changes. The first run downloads two libraries into review/vendor/ (cached).
"""
import json, re, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REVIEW = ROOT / "review"
SKILLS = Path.home() / ".claude" / "skills"

VENDOR = {
    "marked.min.js": "https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js",
    "mermaid.min.js": "https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js",
}

# (id, group, title, path or list of paths) — order = recommended reading order
DOCS = [
    ("frd", "1 · Start here", "Functional Requirements (FRD)", ROOT / "docs/FRD.md"),
    ("decisions", "1 · Start here", "Decisions Log", ROOT / "docs/03_Decisions_Log.md"),
    ("bsd", "2 · Design", "Backend System Design", ROOT / "Backend_System_Design.md"),
    ("exceptions", "2 · Design", "Exception Handling", ROOT / "docs/01_Exception_Handling.md"),
    ("erd", "2 · Design", "Database Schema & ERD", ROOT / "docs/05_Database_ERD.md"),
    ("design", "2 · Design", "Design System", ROOT / "design/DESIGN_SYSTEM.md"),
    ("mockdata", "2 · Design", "Mock Data Guide", ROOT / "codebase/db/seeds/MOCK_DATA.md"),
    ("ops", "2 · Design", "Operations & Runbooks", ROOT / "docs/04_Operations_Runbooks.md"),
    ("deferred", "3 · Deferred", "Reservations, Payments & Delivery", ROOT / "docs/02_Reservations_Payments_Delivery.md"),
    ("concept", "4 · Background", "Original Concept Document", ROOT / "Local_Commerce_Cloud_Inventory_Platform_Detailed_Concept (10).md"),
    ("context", "4 · Background", "Finance & Legal Context", ROOT / ".claude/finance-legal-context.md"),
    ("index", "4 · Background", "Docs Index & Project Rules", [ROOT / "docs/README.md", ROOT / "CLAUDE.md"]),
    ("skill-ca", "5 · Skills", "Skill: India CA & Finance Controller", "skill:india-senior-ca-finance-controller"),
    ("skill-legal", "5 · Skills", "Skill: India Legal Advisor", "skill:india-legal-helper-senior-advisor"),
]


def vendor(name):
    f = REVIEW / "vendor" / name
    if not f.exists():
        f.parent.mkdir(parents=True, exist_ok=True)
        print("downloading", VENDOR[name])
        urllib.request.urlretrieve(VENDOR[name], f)
    return f.read_text(encoding="utf-8").replace("</script", "<\\/script")


def fence_pandoc_tables(md):
    """Pandoc-style grid tables (lines starting '  ----') aren't GFM; show them as preformatted text."""
    out, block = [], None
    for line in md.splitlines():
        if block is None:
            if re.fullmatch(r"  -{10,}[- ]*", line):
                block = [line]
            else:
                out.append(line)
        else:
            block.append(line)
            if re.fullmatch(r"  -{10,}", line) and len(block) > 2:
                out += ["```text", *block, "```"]
                block = None
    if block:
        out += block
    return "\n".join(out)


def read(src):
    if isinstance(src, str) and src.startswith("skill:"):
        d = SKILLS / src[6:]
        files = [d / "SKILL.md", d / "README.md", *sorted((d / "references").glob("*.md"))]
    else:
        files = src if isinstance(src, list) else [src]
    parts = []
    for f in files:
        text = f.read_text(encoding="utf-8")
        text = re.sub(r"\A---\n.*?\n---\n", "", text, flags=re.S)  # drop YAML front matter
        if len(files) > 1:
            text = f"# {f.name}\n\n" + text
        parts.append(text)
    return fence_pandoc_tables("\n\n---\n\n".join(parts)), [str(f) for f in files]


def main():
    docs = []
    for doc_id, group, title, src in DOCS:
        md, files = read(src)
        docs.append({"id": doc_id, "group": group, "title": title, "md": md, "files": files})
    seed_file = REVIEW / "reviews.json"
    seed = json.loads(seed_file.read_text(encoding="utf-8")) if seed_file.exists() else {}

    def js(obj):
        return json.dumps(obj, ensure_ascii=False).replace("</", "<\\/")

    html = (REVIEW / "template.html").read_text(encoding="utf-8")
    html = html.replace("/*__MARKED__*/", vendor("marked.min.js"))
    html = html.replace("/*__MERMAID__*/", vendor("mermaid.min.js"))
    html = html.replace("__DOCS_JSON__", js(docs)).replace("__SEED_JSON__", js(seed))
    out = REVIEW / "Idea01_Review.html"
    out.write_text(html, encoding="utf-8")
    print(f"built {out} ({out.stat().st_size // 1024} KB, {len(docs)} docs, seed notes: {len(seed.get('annotations', []))})")


if __name__ == "__main__":
    main()
