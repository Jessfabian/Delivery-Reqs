/*
  Adaptive Delivery Requirement Sheet renderer.
  Draws a clean, recreated layout and hides empty sections/rows.
*/
(function (root) {
  const RGB = {
    navy: [0 / 255, 46 / 255, 107 / 255],
    blue: [0 / 255, 81 / 255, 168 / 255],
    lightBlue: [0.93, 0.96, 0.99],
    line: [0.78, 0.84, 0.92],
    grayText: [0.35, 0.40, 0.48],
    red: [0.90, 0.13, 0.22],
    black: [0, 0, 0],
    white: [1, 1, 1],
  };

  const CA_OPTION = /(fr2257ca|ca voluntary authorization|ca voluntary electronic delivery)/i;
  const PAC_OPTION = /(f6445|\bpac\b|eft\s*\/\s*pac)/i;

  function b64ToBytes(b64) {
    if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function needsCA(d) { return (d.requirements || []).some((r) => CA_OPTION.test(r.text || "")); }
  function needsPAC(d) { return (d.requirements || []).some((r) => PAC_OPTION.test(r.text || "")); }
  function nz(n) { return Math.abs(Number(n || 0)) > 0.00001; }

  function moneyText(v) {
    return `$ ${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function fit(font, text, size, maxWidth, min) {
    let s = size;
    const floor = min || 7;
    while (s > floor && font.widthOfTextAtSize(String(text), s) > maxWidth) s -= 0.25;
    return s;
  }

  function text(page, v, x, y, size, font, color, maxWidth) {
    page.drawText(String(v || ""), { x, y, size, font, color, maxWidth, lineHeight: size + 1 });
  }

  function drawDiamond(page, x, y, size, color) {
    const h = size / 2;
    const p = `M ${x} ${y + h} L ${x + h} ${y} L ${x + size} ${y + h} L ${x + h} ${y + size} Z`;
    page.drawSvgPath(p, { color });
  }

  function drawX(page, x, y, size, color) {
    page.drawLine({ start: { x, y }, end: { x: x + size, y: y + size }, thickness: 1.4, color });
    page.drawLine({ start: { x, y: y + size }, end: { x: x + size, y }, thickness: 1.4, color });
  }

  async function buildDeliveryPdf(d, assets, PDFLib, fontkit) {
    const { PDFDocument, rgb } = PDFLib;
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);

    const [regular, bold, italic] = await Promise.all([
      doc.embedFont(b64ToBytes(assets.fontRegular), { subset: true }),
      doc.embedFont(b64ToBytes(assets.fontBold), { subset: true }),
      doc.embedFont(b64ToBytes(assets.fontItalic), { subset: true }),
    ]);

    const img = {};
    const keys = [
      "headerArt", "footerArt", "tabPill", "circleBlue", "circleOrange", "circleNavy",
      "iconPolicy", "iconPremium", "iconReturn", "iconImportant", "iconRequirements",
      "iconEmail", "iconCheck", "logoMassMutual", "titleBand", "iconMail",
    ];
    for (const k of keys) img[k] = await doc.embedPng(b64ToBytes(assets[k]));

    const C = {
      navy: rgb(RGB.navy[0], RGB.navy[1], RGB.navy[2]),
      blue: rgb(RGB.blue[0], RGB.blue[1], RGB.blue[2]),
      lightBlue: rgb(RGB.lightBlue[0], RGB.lightBlue[1], RGB.lightBlue[2]),
      line: rgb(RGB.line[0], RGB.line[1], RGB.line[2]),
      grayText: rgb(RGB.grayText[0], RGB.grayText[1], RGB.grayText[2]),
      red: rgb(RGB.red[0], RGB.red[1], RGB.red[2]),
      black: rgb(RGB.black[0], RGB.black[1], RGB.black[2]),
      white: rgb(1, 1, 1),
    };

    const page = doc.addPage([612, 792]);
    page.drawRectangle({ x: 0, y: 0, width: 612, height: 792, color: C.white });
    page.drawImage(img.headerArt, { x: 0, y: 702, width: 612, height: 90 });
    page.drawImage(img.footerArt, { x: 0, y: 0, width: 612, height: 40 });
    page.drawImage(img.logoMassMutual, { x: 28, y: 726, width: 240, height: 32 });
    page.drawImage(img.titleBand, { x: 0, y: 650, width: 612, height: 58 });

    page.drawRectangle({ x: 466, y: 704, width: 140, height: 75, color: C.white, borderColor: C.line, borderWidth: 1.2 });
    const panelRows = [
      ["DELIVERY DATE:", d.deliveryDate || "", C.red],
      ["FREQUENCY:", d.freq || "", C.black],
      ["BALANCE DUE:", d.balanceDueText || moneyText(d.balanceDue), C.black],
    ];
    let panelY = 761;
    for (const [label, value, color] of panelRows) {
      text(page, label, 472, panelY, 8.5, bold, C.navy);
      page.drawRectangle({ x: 540, y: panelY - 4, width: 60, height: 14, color: C.lightBlue });
      text(page, value, 544, panelY, 9.5, bold, color);
      panelY -= 22;
    }

    text(page, "THE PREMIUM MUST BE SUBMITTED WITH ALL PAGES OF THE REQUIREMENTS BY", 56, 620, 10.5, bold, C.navy);
    text(page, d.deliveryDate || "", 505, 620, 11.5, bold, C.red);

    const LEFT = 28;
    const GAP = 18;
    const W = 271;
    const RIGHT = LEFT + W + GAP;

    function sectionTab(x, topY, width, title, circle, icon) {
      const tabY = topY - 36;
      page.drawImage(img.tabPill, { x: x + 10, y: tabY, width: width - 20, height: 32 });
      page.drawImage(img[circle], { x: x - 8, y: tabY - 5, width: 42, height: 42 });
      page.drawImage(img[icon], { x: x + 2, y: tabY + 5, width: 22, height: 22 });
      text(page, title, x + 36, tabY + 11, fit(bold, title, 11, width - 78, 9), bold, C.white);
      return tabY - 4;
    }

    function frame(x, topY, width, height) {
      page.drawRectangle({ x, y: topY - height, width, height, color: C.white, borderColor: C.navy, borderWidth: 1 });
    }

    function valueRow(x, y, width, label, value, labelSize, valueColor) {
      text(page, label, x + 14, y + 4, labelSize || 8.5, bold, C.navy);
      page.drawRectangle({ x: x + 156, y, width: width - 166, height: 14, color: C.lightBlue });
      text(page, value, x + 162, y + 1, fit(bold, value, 10.5, width - 176, 8.5), bold, valueColor || C.black);
    }

    const policyRows = [];
    if ((d.firstName || d.lastName)) policyRows.push(["INSURED", `${d.firstName || ""} ${d.lastName || ""}`.trim()]);
    if (d.policy) policyRows.push(["POLICY #", d.policy]);
    if (d.product) policyRows.push(["PRODUCT", d.product]);

    const fundsRows = [];
    const fundsReceived = Number(d.fundsReceived || 0);
    if (nz(fundsReceived)) fundsRows.push({ label: "TOTAL FUNDS RECEIVED:", value: d.fundsReceivedText || moneyText(fundsReceived) });
    if (nz(d.tlir)) fundsRows.push({ label: "TO BE PAID WITH TLIR:", value: d.tlirText || moneyText(d.tlir), xmark: true });
    if (nz(d.x1035)) fundsRows.push({ label: "TO BE PAID WITH 1035X:", value: d.x1035Text || moneyText(d.x1035), xmark: true });
    if (nz(d.balanceDue)) fundsRows.push({ label: "PAYOR BALANCE DUE:", value: d.balanceDueText || moneyText(d.balanceDue) });

    const topRowY = 586;
    const policyHead = sectionTab(LEFT, topRowY, W, "POLICY INFORMATION", "circleBlue", "iconPolicy");
    const premiumHead = sectionTab(RIGHT, topRowY, W, "TOTAL INITIAL PREMIUM", "circleBlue", "iconPremium");
    const policyH = Math.max(66, 18 + policyRows.length * 24);
    const premiumH = 36 + fundsRows.length * 24 + 14;
    const topH = Math.max(policyH, premiumH);
    frame(LEFT, policyHead, W, topH);
    frame(RIGHT, premiumHead, W, topH);

    let py = policyHead - 24;
    for (const [label, value] of policyRows) {
      text(page, label, LEFT + 14, py + 4, 8.5, bold, C.navy);
      page.drawRectangle({ x: LEFT + 86, y: py, width: W - 96, height: 14, color: C.lightBlue });
      const s = fit(regular, value, 10.5, W - 104, 8.5);
      text(page, value, LEFT + 92, py + 2, s, /#|\d/.test(value) ? bold : regular, C.black);
      py -= 24;
    }

    let ry = premiumHead - 25;
    valueRow(RIGHT, ry - 2, W, "TOTAL INITIAL PREMIUM:", d.premiumText || moneyText(d.premium), 8.5, C.navy);
    ry -= 28;
    for (const row of fundsRows) {
      valueRow(RIGHT, ry - 2, W, row.label, row.value, 8.5, row.xmark ? C.grayText : C.black);
      if (row.xmark) {
        page.drawRectangle({ x: RIGHT + 24, y: ry - 1, width: 12, height: 12, borderColor: C.navy, borderWidth: 1, color: C.white });
        drawX(page, RIGHT + 26.5, ry + 1.2, 7.2, C.navy);
      }
      ry -= 24;
    }

    const secondTop = policyHead - topH - 18;
    const returnHead = sectionTab(LEFT, secondTop, W, "RETURN DELIVERY REQUIREMENTS TO", "circleBlue", "iconReturn");
    const importantHead = sectionTab(RIGHT, secondTop, W, "IMPORTANT INFORMATION", "circleOrange", "iconImportant");

    const importantRows = [
      "FOR FREQUENCY CHANGES AFTER ISSUE",
      "PLEASE CONTACT YOUR ASSIGNED ACCOUNT MANAGER",
    ];
    if (d.isMonthly) {
      importantRows.push("IF THE FREQUENCY IS MONTHLY,");
      importantRows.push(`AND IS DELIVERED AFTER: ${d.deliveryDate || ""}`);
      importantRows.push("AN ADDITIONAL MONTH'S PREMIUM WILL BE REQUIRED");
    }
    importantRows.push("PLEASE MAKE ALL CHECKS PAYABLE TO");
    importantRows.push("MassMutual Financial Group");

    const returnH = 165;
    const importantH = 34 + importantRows.length * 14 + 22;
    const secondH = Math.max(returnH, importantH);
    frame(LEFT, returnHead, W, secondH);
    frame(RIGHT, importantHead, W, secondH);

    const rx = LEFT + 12;
    let iy = returnHead - 28;
    page.drawImage(img.iconEmail, { x: rx, y: iy - 3, width: 18, height: 18 });
    text(page, "LIFEDELIVERYREQUIREMENTS@MASSMUTUAL.COM", rx + 30, iy, 8.5, bold, C.navy);
    page.drawLine({ start: { x: LEFT + 14, y: iy - 12 }, end: { x: LEFT + W - 14, y: iy - 12 }, thickness: 1, color: C.line });

    iy -= 36;
    page.drawImage(img.iconMail, { x: rx, y: iy - 3, width: 18, height: 18 });
    text(page, "MASSMUTUAL FINANCIAL GROUP", rx + 30, iy + 2, 8.5, bold, C.navy);
    text(page, "ATTENTION: LIFE NEW BUSINESS MIP: B235", rx + 30, iy - 10, 8.3, bold, C.navy);
    text(page, "1295 STATE ST", rx + 30, iy - 22, 8.3, bold, C.navy);
    text(page, "SPRINGFIELD MA 01111", rx + 30, iy - 34, 8.3, bold, C.navy);
    page.drawLine({ start: { x: LEFT + 14, y: iy - 42 }, end: { x: LEFT + W - 14, y: iy - 42 }, thickness: 1, color: C.line });
    text(page, "WE ARE UNABLE TO ACCEPT THE INITIAL PREMIUM", LEFT + 30, iy - 58, 8.2, bold, C.blue);
    text(page, "WITHOUT ALL PAGES OF THE REQUIREMENTS", LEFT + 40, iy - 70, 8.2, bold, C.blue);
    text(page, "RETURNED.", LEFT + 114, iy - 82, 8.2, bold, C.blue);

    let imY = importantHead - 24;
    text(page, importantRows[0], RIGHT + 54, imY, 8.5, bold, C.navy);
    imY -= 13;
    text(page, importantRows[1], RIGHT + 34, imY, 8.5, bold, C.navy);
    page.drawLine({ start: { x: RIGHT + 12, y: imY - 8 }, end: { x: RIGHT + W - 12, y: imY - 8 }, thickness: 1, color: C.line });
    imY -= 28;

    if (d.isMonthly) {
      text(page, importantRows[2], RIGHT + 61, imY, 8.5, bold, C.navy);
      imY -= 13;
      const row = importantRows[3];
      const idx = row.lastIndexOf(":");
      if (idx !== -1) {
        text(page, row.slice(0, idx + 1), RIGHT + 38, imY, 8.5, bold, C.navy);
        text(page, row.slice(idx + 1).trim(), RIGHT + 170, imY, 8.5, bold, C.red);
      } else {
        text(page, row, RIGHT + 42, imY, 8.5, bold, C.navy);
      }
      imY -= 13;
      text(page, importantRows[4], RIGHT + 20, imY, 8.5, bold, C.navy);
      page.drawLine({ start: { x: RIGHT + 12, y: imY - 8 }, end: { x: RIGHT + W - 12, y: imY - 8 }, thickness: 1, color: C.line });
      imY -= 25;
      text(page, importantRows[5], RIGHT + 52, imY, 9, bold, C.navy);
      imY -= 13;
      text(page, importantRows[6], RIGHT + 73, imY, 9, bold, C.blue);
    } else {
      text(page, importantRows[2], RIGHT + 52, imY, 9, bold, C.navy);
      imY -= 13;
      text(page, importantRows[3], RIGHT + 73, imY, 9, bold, C.blue);
    }

    page.drawImage(img.iconCheck, { x: RIGHT + 14, y: importantHead - secondH + 10, width: 32, height: 32 });

    const reqTop = Math.min(returnHead - secondH, importantHead - secondH) - 18;
    const reqRows = (d.requirements || []).filter((r) => r && (r.checked || (r.text || "").trim()));
    const reqBase = d.supplement ? 52 : 16;
    const reqH = Math.max(70, reqBase + reqRows.length * 23 + 18);

    const reqHead = sectionTab(LEFT, reqTop, 556, "DELIVERY REQUIREMENTS DUE", "circleNavy", "iconRequirements");
    frame(LEFT, reqHead, 556, reqH);

    let qy = reqHead - 22;
    if (d.supplement) {
      drawDiamond(page, LEFT + 46, qy - 1, 8, C.black);
      text(page, "Supplement to the application - this form includes:", LEFT + 66, qy, 11, italic, C.black);
      qy -= 22;
      text(page, "Insurability Statement | Policy Receipt | Signed Amendment", LEFT + 110, qy, 10.5, italic, C.black);
      qy -= 26;
    }

    for (const req of reqRows) {
      page.drawRectangle({ x: LEFT + 20, y: qy - 2, width: 10, height: 10, borderColor: C.line, borderWidth: 1, color: C.white });
      drawDiamond(page, LEFT + 50, qy - 1, 7, C.black);
      text(page, req.text.trim(), LEFT + 74, qy - 1, fit(regular, req.text.trim(), 10.3, 470, 8), regular, C.black);
      qy -= 23;
    }

    const extras = [];
    if (needsCA(d)) extras.push(assets.caPage);
    if (needsPAC(d)) extras.push(assets.pacPages);
    for (const b64 of extras) {
      const src = await PDFDocument.load(b64ToBytes(b64));
      const pages = await doc.copyPages(src, src.getPageIndices());
      pages.forEach((pg) => doc.addPage(pg));
    }

    doc.setTitle(`${d.policy || "Policy"} ${d.lastName || ""} Delivery Requirements`.trim());
    doc.setSubject("MassMutual Policy Delivery Requirements");
    return doc.save();
  }

  const api = { buildDeliveryPdf, needsCA, needsPAC, b64ToBytes, moneyText };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DeliveryPdf = api;
})(typeof window !== "undefined" ? window : globalThis);
