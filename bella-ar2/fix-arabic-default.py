#!/usr/bin/env python3
"""Bella Boutique — Arabic-first patch.

Run from the repo root:  python3 fix-arabic-default.py
Patches index.html + every product-*.html + authenticity.html in place.
Idempotent: re-running does nothing.
"""
import io, os, re, sys, glob, shutil

SRC = sys.argv[1] if len(sys.argv) > 1 else "."
OUT = sys.argv[2] if len(sys.argv) > 2 else SRC

PINNED = ["lady-dior-grey", "lv-dauphine", "dior-bobby", "chanel-frame"]

LANG_INIT = ('let LANG = (function(){ try { return localStorage.getItem("bella_lang") || "ar"; }'
             ' catch(e){ return "ar"; } })();')
PERSIST = 'try{ localStorage.setItem("bella_lang", LANG); }catch(e){}'

report = []


def read(p):
    return io.open(p, encoding="utf-8").read()


def write(p, s):
    os.makedirs(os.path.dirname(p) or ".", exist_ok=True)
    io.open(p, "w", encoding="utf-8").write(s)


def patch_common(h, name):
    """Arabic default + persisted toggle. Applies to every page."""
    done = []

    # 1. <html lang="en" dir="ltr">  ->  ar / rtl   (kills the English flash on load)
    if '<html lang="en" dir="ltr">' in h:
        h = h.replace('<html lang="en" dir="ltr">', '<html lang="ar" dir="rtl">', 1)
        done.append("html lang=ar")

    # 2. LANG default -> Arabic, remembering an explicit English choice
    h2 = re.sub(r'let LANG\s*=\s*"en"\s*;', LANG_INIT, h, count=1)
    if h2 != h:
        h, _ = h2, done.append("LANG default=ar")

    # 3a. index.html style toggle
    old = 'function toggleLang(){ LANG = LANG==="en" ? "ar" : "en"; applyLang(); }'
    if old in h:
        h = h.replace(old, 'function toggleLang(){ LANG = LANG==="en" ? "ar" : "en"; '
                           + PERSIST + ' applyLang(); }', 1)
        done.append("toggle persists")

    # 3b. product page style listener
    old = ('document.getElementById("langBtn").addEventListener("click",()=>'
           '{LANG=LANG==="en"?"ar":"en";applyLang();});')
    if old in h:
        h = h.replace(old, 'document.getElementById("langBtn").addEventListener("click",()=>'
                           '{LANG=LANG==="en"?"ar":"en";' + PERSIST + 'applyLang();});', 1)
        done.append("toggle persists")

    report.append(f"  {name:34s} {', '.join(done) if done else 'already patched'}")
    return h


def patch_index(h):
    # 4. show 12 before the "view more" button
    h = h.replace("const PAGE_SIZE = 6;", "const PAGE_SIZE = 12;", 1)

    # 5. pinned-first ordering (ad bags), then newest-first, sold always last
    old = "const list = base.slice().sort((a,b) => (a.sold?1:0) - (b.sold?1:0));"
    new = ("""const rank = p => { const i = PINNED.indexOf(p.id); return i === -1 ? PINNED.length : i; };
  const list = base.slice().map((p,i) => ({p,i}))
    .sort((a,b) => (a.p.sold?1:0) - (b.p.sold?1:0) || rank(a.p) - rank(b.p) || a.i - b.i)
    .map(x => x.p);""")
    if old in h:
        h = h.replace(old, new, 1)
        h = h.replace("const PAGE_SIZE = 12;",
                      "const PAGE_SIZE = 12;\n// حقائب الإعلان — تظهر أولاً مهما كان ترتيب الإضافة\n"
                      "const PINNED = " + str(PINNED).replace("'", '"') + ";", 1)

    # 6. move the products grid directly under the moving brand strip
    fs = h.index("<!-- ================= FEATURED ================= -->")
    fe = h.index("</section>", h.index('<section class="featured', fs)) + len("</section>")
    block = h[fs:fe]
    h = h[:fs] + h[fe:]
    anchor = "<!-- ================= WHY ================= -->"
    h = h.replace(anchor, block + "\n\n" + anchor, 1)
    return h


# ---------------------------------------------------------------- run
others = sorted(os.path.basename(p) for p in glob.glob(os.path.join(SRC, "*.html"))
                if os.path.basename(p) != "index.html")
files = ["index.html"] + others

print("Patching:")
for name in files:
    src = os.path.join(SRC, name)
    if not os.path.exists(src):
        continue
    h = read(src)
    h = patch_common(h, name)
    if name == "index.html":
        h = patch_index(h)
    write(os.path.join(OUT, name), h)

print("\n".join(report))
print(f"\nDone — {len(report)} files.")
