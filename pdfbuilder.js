/*
  Fills the original MMSD Delivery Requirement Sheet and returns the PDF bytes.

  Mirrors the form's own Acrobat JavaScript "print view":
    - case-only fields (product, contacts, agent, UW, account manager) and buttons are hidden
    - requirement rows that are unchecked and empty are hidden
    - requirement checkboxes tick automatically when the row has text
    - TLIR / 1035 checkboxes tick when an amount is entered
    - CA consent page / 4-page PAC form are appended when those requirements are selected
  The result is flattened so it looks the same in every viewer and can't be edited.
*/
(function (root) {
  const CA_OPTION = /ca voluntary authorization/i;
  const PAC_OPTION = /eft\s*\/\s*pac/i;

  const HIDDEN_FIELDS = ["ProductType", "VT", "WL", "wlbtn", "name1", "email1", "agent", "uw", "am2", "am1",
    "Button2", "Button1", "Clear"];

  function b64ToBytes(b64) {
    if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function needsCA(d) { return d.requirements.some((r) => CA_OPTION.test(r.text)); }
  function needsPAC(d) { return d.requirements.some((r) => PAC_OPTION.test(r.text)); }

  // Parse "/CenturyGothic,Bold 12 Tf 0.898 0.133 0.215 rg" -> { bold, size, color }
  function parseDA(da, rgb) {
    const s = String(da || "");
    const font = /\/([^\s]+)\s+([\d.]+)\s+Tf/.exec(s);
    const rgbM = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/.exec(s);
    const grayM = /([\d.]+)\s+g(\s|$)/.exec(s.replace(/Tf/, ""));
    let color = rgb(0, 0, 0);
    if (rgbM) color = rgb(+rgbM[1], +rgbM[2], +rgbM[3]);
    else if (grayM) color = rgb(+grayM[1], +grayM[1], +grayM[1]);
    return { bold: !!font && /Bold/i.test(font[1]), size: font ? +font[2] : 0, color };
  }

  async function buildDeliveryPdf(d, assets, PDFLib, fontkit) {
    const { PDFDocument, PDFName, PDFString, PDFHexString, rgb } = PDFLib;
    const doc = await PDFDocument.load(b64ToBytes(assets.form));
    doc.registerFontkit(fontkit);
    const regular = await doc.embedFont(b64ToBytes(assets.fontRegular), { subset: true });
    const bold = await doc.embedFont(b64ToBytes(assets.fontBold), { subset: true });
    const form = doc.getForm();
    const page = doc.getPages()[0];

    const decodeDA = (dict) => {
      const v = dict && dict.lookup(PDFName.of("DA"));
      return v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : null;
    };
    const widgetDA = (widget, field) =>
      decodeDA(widget.dict) || decodeDA(field.acroField.dict) || decodeDA(form.acroForm.dict) || "";

    // pdf-lib's removeField/flatten fail on this form's checkboxes (no "Off" appearance), so
    // widgets are detached from the pages and the field from the AcroForm directly.
    const remove = (name) => {
      const field = form.getFieldMaybe(name);
      if (!field) return;
      const pages = doc.getPages();
      for (const widget of field.acroField.getWidgets()) {
        const ref = doc.context.getObjectRef(widget.dict);
        if (ref) pages.forEach((pg) => pg.node.removeAnnot(ref));
      }
      form.acroForm.removeField(field.acroField);
    };

    // Draw the value into every widget of the field exactly as Acrobat would (widget DA font,
    // size and colour, 2pt padding, vertically centred), then drop the field.
    const setText = (name, value, colorOverride) => {
      const field = form.getField(name);
      const text = value == null ? "" : String(value);
      for (const widget of field.acroField.getWidgets()) {
        if (!text) continue;
        const da = parseDA(widgetDA(widget, field), rgb);
        const font = da.bold ? bold : regular;
        const r = widget.getRectangle();
        const maxW = r.width - 4;
        let size = da.size || 10;
        while (size > 5 && font.widthOfTextAtSize(text, size) > maxW) size -= 0.25;
        const full = font.heightAtSize(size);
        const descent = full - font.heightAtSize(size, { descender: false });
        const q = widget.dict.lookup(PDFName.of("Q")) || field.acroField.dict.lookup(PDFName.of("Q"));
        const align = q ? Number(q.toString()) : 0;
        const w = font.widthOfTextAtSize(text, size);
        const x = align === 1 ? r.x + (r.width - w) / 2 : align === 2 ? r.x + r.width - 2 - w : r.x + 2;
        page.drawText(text, {
          x, y: r.y + (r.height - full) / 2 + descent, size, font,
          color: colorOverride ? colorOverride(rgb) : da.color,
        });
      }
      remove(name);
    };
    const setChoice = setText;
    // An unchecked box has no appearance in this form, so removing it is visually identical.
    const setCheck = (name, on) => {
      if (on) form.getCheckBox(name).check(); else remove(name);
    };

    setText("Date19_af_date", d.deliveryDate);
    setChoice("freq", d.freq);
    setText("firstName", d.firstName);
    setText("Lastname", d.lastName);
    setText("Policynum", d.policy);
    setText("Text24", d.premiumText);
    setText("Text25", d.fundsReceivedText);
    // TLIR / 1035 amounts show grey when they are only the 0.00 placeholder (form's focus/blur scripts)
    setText("TLIR_TXT", d.tlirText, d.tlir > 0 ? (c) => c(0, 0, 0) : null);
    setText("1035_TXT", d.x1035Text, d.x1035 > 0 ? (c) => c(0, 0, 0) : null);
    setCheck("TLIR", d.tlir > 0);
    setCheck("1035", d.x1035 > 0);
    setText("Text28", d.balanceDueText);
    setCheck("Check Box10", d.supplement);

    d.requirements.forEach((req, i) => {
      const n = i + 1;
      const text = (req.text || "").trim();
      const checked = req.checked || text !== "";
      if (!checked && !text) {
        remove("Bx" + n);
        remove("Req" + n);
        return;
      }
      if (n <= 4) setChoice("Req" + n, text); else setText("Req" + n, text);
      setCheck("Bx" + n, checked);
    });

    HIDDEN_FIELDS.forEach(remove);
    form.flatten({ updateFieldAppearances: false });

    // flatten() deletes widget objects but can leave their references in /Annots
    for (const pg of doc.getPages()) {
      const annots = pg.node.Annots();
      if (!annots) continue;
      for (let i = annots.size() - 1; i >= 0; i--) {
        const item = annots.get(i);
        if (item instanceof PDFLib.PDFRef && !doc.context.lookup(item)) annots.remove(i);
      }
    }

    const acro = doc.catalog.lookup(PDFName.of("AcroForm"));
    if (acro) acro.delete(PDFName.of("CO"));

    const extras = [];
    if (needsCA(d)) extras.push(assets.caPage);
    if (needsPAC(d)) extras.push(assets.pacPages);
    for (const b64 of extras) {
      const src = await PDFDocument.load(b64ToBytes(b64));
      const pages = await doc.copyPages(src, src.getPageIndices());
      pages.forEach((pg) => doc.addPage(pg));
    }

    doc.setTitle(`${d.policy} ${d.lastName} Delivery Requirements`);
    doc.setSubject("MassMutual Policy Delivery Requirements");
    return doc.save();
  }

  const api = { buildDeliveryPdf, needsCA, needsPAC, b64ToBytes };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DeliveryPdf = api;
})(typeof window !== "undefined" ? window : globalThis);
