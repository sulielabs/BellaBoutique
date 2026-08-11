#!/usr/bin/env python3
"""يضيف شريط طرق الدفع إلى تذييل كل الصفحات."""
import io, os, glob, sys, shutil

SRC, OUT = sys.argv[1], sys.argv[2]

CSS = """
/* --- شريط طرق الدفع --- */
.paybar{border-top:1px solid rgba(255,255,255,.10);margin-top:1.6rem;padding-top:1.3rem;text-align:center}
.paybar .paylabel{font-size:.7rem;letter-spacing:.16em;text-transform:uppercase;opacity:.55;margin-bottom:.85rem}
.paybar .payrow{display:flex;gap:.55rem;justify-content:center;align-items:center;flex-wrap:wrap}
.paybar .payrow img{height:26px;width:auto;background:#fff;border-radius:5px;padding:4px 7px;box-sizing:content-box;opacity:.95}
.paybar .paynote{font-size:.72rem;opacity:.5;margin-top:.85rem;line-height:1.7;max-width:34rem;margin-inline:auto}
@media(max-width:520px){.paybar .payrow img{height:21px}}
"""

BAR = """  <div class="paybar">
    <div class="paylabel" data-i18n="pay_label">Payment Methods</div>
    <div class="payrow">
      <img src="assets/pay/apple-pay.svg" alt="Apple Pay" loading="lazy" decoding="async">
      <img src="assets/pay/mada.svg" alt="مدى mada" loading="lazy" decoding="async">
      <img src="assets/pay/visa.svg" alt="Visa" loading="lazy" decoding="async">
      <img src="assets/pay/mastercard.svg" alt="Mastercard" loading="lazy" decoding="async">
      <img src="assets/pay/stcpay.svg" alt="stc pay" loading="lazy" decoding="async">
      <img src="assets/pay/bank.svg" alt="تحويل بنكي" loading="lazy" decoding="async">
    </div>
    <div class="paynote" data-i18n="pay_note">A secure payment link is issued after your order is confirmed on WhatsApp. Bank transfer also available.</div>
  </div>
"""

I18N = ('  pay_label:{en:"Payment Methods",ar:"طرق الدفع"},\n'
        '  pay_note:{en:"A secure payment link is issued after your order is confirmed on WhatsApp. Bank transfer also available.",'
        'ar:"يُرسل رابط دفع آمن بعد تأكيد الطلب عبر واتساب. والتحويل البنكي متاح أيضاً."},\n')

n = 0
for path in sorted(glob.glob(os.path.join(SRC, "*.html"))):
    name = os.path.basename(path)
    h = io.open(path, encoding="utf-8").read()
    if "paybar" in h:
        continue

    # 1) CSS قبل نهاية أول <style>
    i = h.index("</style>")
    h = h[:i] + CSS + h[i:]

    # 2) الشريط قبل نهاية <footer>
    j = h.rindex("</footer>")
    h = h[:j] + BAR + h[j:]

    # 3) مفاتيح الترجمة في أول عنصر بالقاموس
    k = h.find("const i18n={")
    if k == -1: k = h.index("const i18n = {")
    nl = h.index("\n", k) + 1
    h = h[:nl] + I18N + h[nl:]

    io.open(os.path.join(OUT, name), "w", encoding="utf-8").write(h)
    n += 1

print("patched", n, "files")
