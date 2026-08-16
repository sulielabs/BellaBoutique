#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
bella-patch.py  —  يصلح كل صفحات الموقع دفعة واحدة

  1) صياغة التوثيق:  «موثّقة قبل العرض»  ->  «تُفحص قبل الشحن»
  2) إزالة target="_blank" من روابط واتساب  (يكسر التسليم داخل متصفح تيك توك)
  3) استبدال window.open بـ location.href  (المنبثقات محجوبة داخل التطبيقات)
  4) بوابة جاهزية قبل ViewContent + تأخير الانتقال ٤٠٠ مللي قبل Contact

الاستخدام من داخل مجلد الموقع:
    python3 bella-patch.py .

آمن للتشغيل أكثر من مرة. لا يلمس ملفًا لا يحتاج تعديلًا.
"""
import re, sys, pathlib

T_EN = "Authenticated before dispatch"
T_AR = "تُفحص قبل الشحن"
B_EN = ("Once your order is confirmed, the piece is inspected by an independent third-party "
        "specialist in luxury authentication. It ships to you together with the authenticity "
        "certificate issued for it.")
B_AR = ("بعد تأكيد طلبك، تُفحص القطعة من جهة مستقلة متخصصة في توثيق السلع الفاخرة، "
        "وتصلك ومعها شهادة الأصالة الصادرة لها.")

READY = '''  /* انتظري تحميل بكسل تيك توك فعليًا.
     داخل متصفح تيك توك يتأخر events.js، وأي حدث يُوضع في الطابور قبل وصوله يضيع
     عند مغادرة الصفحة. */
  function whenReady(cb){
    try{
      if(typeof ttq !== "undefined" && typeof ttq.ready === "function"){ ttq.ready(cb); return; }
    }catch(e){}
    var tries = 0;
    (function poll(){
      var up = (typeof ttq !== "undefined") && !Array.isArray(ttq);
      if(up || ++tries > 40) return cb();
      setTimeout(poll, 150);
    })();
  }

'''

def patch(text, is_index):
    log = []

    # ---------- 1) wording ----------
    n = 0
    for key, en, ar in (("v_title", T_EN, T_AR), ("v_body", B_EN, B_AR)):
        text, c = re.subn(key + r':\{en:"(?:[^"\\]|\\.)*",ar:"(?:[^"\\]|\\.)*"\}',
                          f'{key}:{{en:"{en}",ar:"{ar}"}}', text)
        n += c
    text, c = re.subn(r'(<h4 data-i18n="v_title">).*?(</h4>)',
                      lambda m: m.group(1)+T_EN+m.group(2), text, flags=re.S); n += c
    text, c = re.subn(r'(<p data-i18n="v_body">).*?(</p>)',
                      lambda m: m.group(1)+B_EN+m.group(2), text, flags=re.S); n += c
    if n: log.append(f"wording×{n}")

    # ---------- 2) target="_blank" on WhatsApp only ----------
    before = text
    text = text.replace('<a class="btn btn--wa" id="waBtn" target="_blank" rel="noopener">',
                        '<a class="btn btn--wa" id="waBtn" rel="noopener">')
    text = text.replace('href="${waLink(msg)}" target="_blank" rel="noopener"',
                        'href="${waLink(msg)}"')
    text = text.replace('a.href = waLink(msg); a.target="_blank"; a.rel="noopener";',
                        'a.href = waLink(msg); a.removeAttribute("target");')
    text = text.replace(
        'document.getElementById("waBtn").href=`https://wa.me/${WHATSAPP}?text=${encodeURIComponent(msg)}`;',
        'var _wb=document.getElementById("waBtn"); _wb.href=`https://wa.me/${WHATSAPP}?text=${encodeURIComponent(msg)}`; _wb.removeAttribute("target");')
    if text != before: log.append("wa-blank")

    # ---------- 3) window.open ----------
    before = text
    text = text.replace('window.open(waLink(msg), "_blank", "noopener");',
                        'location.href = waLink(msg);')
    if text != before: log.append("window.open")

    # ---------- 4) pixel timing ----------
    if "function whenReady(cb)" not in text:
        old_vc = '  var prod = fromLD();\n  if(prod) fire("ViewContent", prod);'
        new_vc = READY + '  var prod = fromLD();\n  if(prod) whenReady(function(){ fire("ViewContent", prod); });'
        if old_vc in text:
            text = text.replace(old_vc, new_vc); log.append("ready-gate")

    old_click = '''    var a = e.target.closest ? e.target.closest('a[href*="wa.me"]') : null;
    if(!a) return;
    fire("Contact", fromCard(a) || fromLD());'''
    new_click = '''    var a = e.target.closest ? e.target.closest('a[href*="wa.me"]') : null;
    if(!a) return;
    if(a.getAttribute("data-sent") === "1") return;   /* النقرة الحقيقية الثانية */
    e.preventDefault();
    fire("Contact", fromCard(a) || fromLD());
    a.setAttribute("data-sent","1");
    var href = a.href;
    setTimeout(function(){ location.href = href; }, 400);'''
    if old_click in text:
        text = text.replace(old_click, new_click); log.append("click-hold")

    return text, log

root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")
files = sorted(list(root.glob("product-*.html")) + list(root.glob("index.html")))
if not files:
    print("لم أجد ملفات HTML في:", root.resolve()); sys.exit(1)

touched = 0
for f in files:
    src = f.read_text(encoding="utf-8")
    out, log = patch(src, f.name == "index.html")
    if out != src:
        f.write_text(out, encoding="utf-8"); touched += 1
        print(f"  ✓ {f.name:40} {' · '.join(log)}")
    else:
        print(f"  – {f.name:40} سليمة أصلًا")

print(f"\nالمجموع: {touched} من {len(files)} ملف عُدّل.")
