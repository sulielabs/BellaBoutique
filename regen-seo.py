#!/usr/bin/env python3
"""Regenerate the ItemList schema, the <noscript> fallback, and the product list
in llms.txt from the `products` array in index.html.

Run this after adding or removing a product:  python3 regen-seo.py
"""
import json, re, html, subprocess

S = '{{SITE_URL}}'

# ---------- pull products + faqs out of index.html via node ----------
JS = '''
const fs=require("fs");const t=fs.readFileSync("index.html","utf8");
const p=t.match(/const products = \\[([\\s\\S]*?)\\n\\];/)[1];
const f=t.match(/const faqs = \\[([\\s\\S]*?)\\n\\];/)[1];
console.log(JSON.stringify({products:eval("["+p+"]"),faqs:eval("["+f+"]")}));
'''
data = json.loads(subprocess.run(['node', '-e', JS], capture_output=True, text=True, check=True).stdout)
products, faqs = data['products'], data['faqs']

# ---------- ItemList ----------
items = []
for i, p in enumerate(products, 1):
    items.append({
        "@type": "ListItem", "position": i,
        "item": {
            "@type": "Product",
            "@id": f"{S}/{p['page']}#product",
            "name": f"{p['brand']} {p['name']['ar']}",
            "alternateName": f"{p['brand']} {p['name']['en']}",
            "url": f"{S}/{p['page']}",
            "image": f"{S}/{p['img']}",
            "brand": {"@type": "Brand", "name": p['brand']},
            "itemCondition": "https://schema.org/UsedCondition",
            "offers": {
                "@type": "Offer", "url": f"{S}/{p['page']}",
                "priceCurrency": "SAR", "price": p['price'].replace(',', ''),
                "availability": "https://schema.org/" + ("OutOfStock" if p.get('sold') else "InStock"),
                "itemCondition": "https://schema.org/UsedCondition",
            },
        }})

itemlist = {"@context": "https://schema.org", "@type": "ItemList",
            "name": "حقائب بيلا بوتيك المتوفرة", "url": f"{S}/#featured",
            "numberOfItems": len(products), "itemListElement": items}

faqpage = {"@context": "https://schema.org", "@type": "FAQPage", "inLanguage": "ar",
           "mainEntity": [{"@type": "Question", "name": f['q']['ar'],
                           "acceptedAnswer": {"@type": "Answer", "text": f['a']['ar']}} for f in faqs]}

def tag(o):
    return '  <script type="application/ld+json">' + json.dumps(o, ensure_ascii=False, separators=(',', ':')) + '</script>\n'

schema_block = tag(itemlist) + tag(faqpage)

# ---------- noscript ----------
rows = []
for p in products:
    nm = html.escape(f"{p['brand']} {p['name']['ar']} — {p['name']['en']}")
    sold = ' — مباعة' if p.get('sold') else ''
    rows.append(f'  <li><a href="{p["page"]}">{nm}</a> — {html.escape(p["cond"]["ar"])} — {p["price"]} ريال سعودي{sold}</li>')
faq_rows = [f'  <dt>{html.escape(f["q"]["ar"])}</dt><dd>{html.escape(f["a"]["ar"])}</dd>' for f in faqs]

ns = ('<noscript>\n<div class="ns-fallback">\n'
      '<h2>حقائب بيلا بوتيك المتوفرة</h2>\n'
      '<p>حقائب يد فاخرة أصلية ١٠٠٪ من Louis Vuitton وGucci وChanel وDior وSaint Laurent وBalenciaga وCeline وLoewe. '
      'كل قطعة موثّقة بشهادة أصالة، مصنّفة الحالة بصدق، مع شحن مؤمّن داخل السعودية والطلب عبر واتساب.</p>\n'
      '<ul>\n' + '\n'.join(rows) + '\n</ul>\n'
      '<h2>الأسئلة الشائعة</h2>\n<dl>\n' + '\n'.join(faq_rows) + '\n</dl>\n'
      '<p><a href="authenticity.html">كيف نتحقق من الأصالة</a> · <a href="shipping.html">الشحن والتوصيل</a></p>\n'
      '</div>\n</noscript>\n')

# ---------- write back into index.html ----------
s = open('index.html', encoding='utf-8').read()
s = re.sub(r'  <script type="application/ld\+json">\{"@context":"https://schema\.org","@type":"ItemList".*?</script>\n'
           r'  <script type="application/ld\+json">\{"@context":"https://schema\.org","@type":"FAQPage".*?</script>\n',
           schema_block, s, flags=re.S)
s = re.sub(r'<noscript>\n<div class="ns-fallback">.*?</div>\n</noscript>\n', ns, s, flags=re.S)
open('index.html', 'w', encoding='utf-8').write(s)

# ---------- llms.txt product list ----------
lines = [f"- [{p['brand']} {p['name']['ar']} — {p['name']['en']}](/{p['page']}): "
         f"{p['cond']['ar']} · {p['price']} SAR" + (' · مباعة' if p.get('sold') else '')
         for p in products]
t = open('llms.txt', encoding='utf-8').read()
t = re.sub(r'(## الحقائب المتوفرة\n)(?:- .*\n)+', r'\1' + '\n'.join(lines) + '\n', t)
open('llms.txt', 'w', encoding='utf-8').write(t)

print(f'regenerated for {len(products)} products, {len(faqs)} faqs')
