(function () {
  const $ = (s) => document.querySelector(s);
  const form = $("#caseForm");
  const reqList = $("#reqList");
  const reqChips = $("#reqChips");
  const extraPages = $("#extraPages");
  const toast = $("#toast");
  const emailsWrap = $("#emails");
  const pdfFrame = $("#pdfFrame");
  const outlookStatus = $("#outlookStatus");
  const signerRows = $("#signerRows");
  const MAX_REQ = 7;
  let lastPdfBytes = null;
  let lastEmails = [];
  let apiStatus = null;

  const REQ_OPTIONS = [
    { label: "Signed Illustration", text: "Signed Illustration" },
    { label: "F6445 PAC form", text: "F6445 PAC form" },
    { label: "W-9 Tax Identification Form", text: "W-9 Tax Identification Form" },
    { label: "NY Supplement to Application", text: "NY Supplement to Application" },
    { label: "Blank EFT/PAC Form", text: "Blank EFT/PAC Form" },
    { label: "FR2257CA (DocuSign / e-signature only)", text: "FR2257CA - CA Voluntary Authorization Form" },
  ];
  const SIGNER_ROLES = [
    ["Agency Contact", ""],
    ["Broker", ""],
    ["Payor", ""],
    ["Owner #1", ""],
    ["Owner #2 (Optional)", ""],
    ["Insured #1", ""],
    ["Insured #2 (Optional)", ""],
  ];

  const STORE_KEY = "mmsd_delivery_contacts_v1";

  function decodeB64(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function b64FromBytes(bytes) {
    let s = "";
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
    return btoa(s);
  }

  function fmtMoney(v) {
    return `$ ${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function parseNum(v) {
    const n = Number(String(v || "").replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }

  function mmddyyyy(iso) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || "";
    const [y, m, d] = iso.split("-");
    return `${m}/${d}/${y}`;
  }

  function showToast(msg) {
    toast.textContent = msg;
    toast.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => (toast.hidden = true), 2500);
  }

  function defaultDateIso() {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function blankRows() {
    return [...reqList.querySelectorAll("li:not([data-coded])")];
  }

  function ensureBlankRow() {
    const blanks = blankRows();
    const empty = blanks.filter((li) => !li.querySelector("input[type='text']").value.trim());
    if (!empty.length && reqList.children.length < MAX_REQ) addReq("", false);
  }

  // Coded requirements (from chips) are always listed above free-typed ones.
  function addReq(text, checked, coded) {
    if (reqList.children.length >= MAX_REQ) {
      const spare = blankRows().reverse().find((li) => !li.querySelector("input[type='text']").value.trim());
      if (!coded || !spare) return;
      spare.remove();
    }
    const li = document.createElement("li");
    if (coded) li.dataset.coded = text;
    li.innerHTML = `<div class="r">
      <input type="checkbox" ${checked ? "checked" : ""}>
      <input type="text" maxlength="120" value="${(text || "").replace(/"/g, "&quot;")}" placeholder="Other requirement (type here)">
      <button type="button" class="x" aria-label="Remove">×</button>
    </div>`;
    li.querySelector("input[type='text']").addEventListener("input", () => {
      const t = li.querySelector("input[type='text']");
      if (!coded) t.closest("li").querySelector("input[type='checkbox']").checked = !!t.value.trim();
      ensureBlankRow();
      updateReqNote();
    });
    li.querySelector("input[type='checkbox']").addEventListener("change", updateReqNote);
    li.querySelector(".x").addEventListener("click", () => {
      li.remove();
      ensureBlankRow();
      updateReqNote();
      refreshChips();
    });
    const firstBlank = blankRows()[0];
    if (coded && firstBlank) reqList.insertBefore(li, firstBlank);
    else reqList.appendChild(li);
    refreshChips();
    updateReqNote();
  }
  function getReqs() {
    return [...reqList.querySelectorAll("li")].map((li) => {
      const t = li.querySelector("input[type='text']").value.trim();
      const c = li.querySelector("input[type='checkbox']").checked;
      return { text: t, checked: c };
    });
  }

  function refreshChips() {
    const coded = new Set([...reqList.querySelectorAll("li[data-coded]")].map((li) => li.dataset.coded));
    const full = reqList.querySelectorAll("li[data-coded]").length >= MAX_REQ;
    reqChips.querySelectorAll(".chip").forEach((c) => {
      const on = coded.has(c.dataset.req);
      c.classList.toggle("on", on);
      c.setAttribute("aria-pressed", on ? "true" : "false");
      c.disabled = !on && full;
    });
  }

  function updateReqNote() {
    const method = form.method.value;
    const reqs = getReqs();
    const hasCA = reqs.some((r) => /(FR2257CA|CA Voluntary)/i.test(r.text || ""));
    const hasPac = reqs.some((r) => /(F6445|PAC)/i.test(r.text || ""));
    const notes = [];
    if (hasPac) notes.push("F6445 PAC form will be appended to the generated PDF.");
    if (hasCA && method === "docusign") {
      notes.push("FR2257CA will be appended (DocuSign scenario).");
    } else if (hasCA) {
      notes.push("FR2257CA is ignored for PDF delivery (it is needed only for electronic signatures).");
    }
    if (!notes.length) {
      extraPages.hidden = true;
      extraPages.textContent = "";
    } else {
      extraPages.hidden = false;
      extraPages.textContent = notes.join(" ");
    }
  }

  function setupReqUi() {
    REQ_OPTIONS.forEach((opt) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.textContent = opt.label;
      b.dataset.req = opt.text;
      b.addEventListener("click", () => {
        const existing = [...reqList.querySelectorAll("li[data-coded]")].find((li) => li.dataset.coded === opt.text);
        if (existing) {
          existing.remove();
          ensureBlankRow();
          refreshChips();
          updateReqNote();
        } else {
          addReq(opt.text, true, true);
        }
      });
      reqChips.appendChild(b);
    });
    addReq("", false);
    $("#addReq").addEventListener("click", () => addReq("", false));
  }

  function renderSignerRows() {
    signerRows.innerHTML = "";
    for (const [role, code] of SIGNER_ROLES) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${role}</td>
        <td><input type="text" data-k="name"></td>
        <td><input type="email" data-k="email"></td>
        <td><input type="text" data-k="code" value="${code}"></td>`;
      signerRows.appendChild(tr);
    }
  }

  function signerData(policyNum) {
    const rows = [...signerRows.querySelectorAll("tr")];
    return rows.map((r, i) => {
      const role = SIGNER_ROLES[i][0];
      const name = r.querySelector("[data-k='name']").value.trim();
      const email = r.querySelector("[data-k='email']").value.trim();
      const code = (r.querySelector("[data-k='code']").value.trim() || (role === "Agency Contact" ? policyNum : ""));
      return { role, name, email, code };
    });
  }

  function updateTotals() {
    const tlir = parseNum(form.tlir.value);
    const x1035 = parseNum(form.x1035.value);
    const premium = parseNum(form.premium.value);
    const funds = tlir + x1035;
    const balance = Math.max(0, premium - funds);
    $("#tFunds").textContent = fmtMoney(funds);
    $("#tBalance").textContent = fmtMoney(balance);
    $("#freqHint").textContent = form.freq.value === "Monthly"
      ? `Monthly: if delivered after ${mmddyyyy(form.deliveryDate.value || defaultDateIso())}, an additional month's premium may be required.`
      : "";
  }

  function highlightInvalid() {
    let ok = true;
    form.querySelectorAll("[required]").forEach((el) => {
      const valid = !!String(el.value || "").trim();
      el.classList.toggle("invalid", !valid);
      if (!valid) ok = false;
    });
    return ok;
  }

  function buildData() {
    const method = form.method.value;
    const freq = form.freq.value;
    const deliveryDate = mmddyyyy(form.deliveryDate.value);
    const premium = parseNum(form.premium.value);
    const tlir = parseNum(form.tlir.value);
    const x1035 = parseNum(form.x1035.value);
    const funds = tlir + x1035;
    const reqs = getReqs().filter((r) => r.checked && r.text.trim());

    const filteredReqs = reqs.filter((r) => {
      if (/(FR2257CA|CA Voluntary)/i.test(r.text) && method !== "docusign") return false;
      return true;
    });

    return {
      method,
      freq,
      isMonthly: freq === "Monthly",
      deliveryDate,
      firstName: form.firstName.value.trim(),
      lastName: form.lastName.value.trim(),
      policy: form.policy.value.trim(),
      product: "",
      premium,
      premiumText: fmtMoney(premium),
      tlir,
      tlirText: fmtMoney(tlir),
      x1035,
      x1035Text: fmtMoney(x1035),
      fundsReceived: funds,
      fundsReceivedText: fmtMoney(funds),
      balanceDue: Math.max(0, premium - funds),
      balanceDueText: fmtMoney(Math.max(0, premium - funds)),
      supplement: !!form.supplement.checked,
      requirements: filteredReqs,
      bgaName: form.bgaName.value.trim(),
      bgaEmail: form.bgaEmail.value.trim(),
      amName: form.amName.value.trim(),
      amEmail: form.amEmail.value.trim(),
      uw: form.uw.value.trim(),
      agent: form.agent.value.trim(),
      signers: signerData(form.policy.value.trim()),
    };
  }

  function saveContacts(d) {
    const old = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    const push = (k, v) => {
      if (!v) return;
      old[k] = old[k] || [];
      if (!old[k].includes(v)) old[k].unshift(v);
      old[k] = old[k].slice(0, 10);
    };
    push("bgaName", d.bgaName);
    push("bgaEmail", d.bgaEmail);
    push("amName", d.amName);
    push("amEmail", d.amEmail);
    push("uw", d.uw);
    push("agent", d.agent);
    localStorage.setItem(STORE_KEY, JSON.stringify(old));
  }

  function loadContacts() {
    const m = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    const map = [
      ["dlBgaName", "bgaName"],
      ["dlBgaEmail", "bgaEmail"],
      ["dlAmName", "amName"],
      ["dlAmEmail", "amEmail"],
      ["dlUw", "uw"],
      ["dlAgent", "agent"],
    ];
    map.forEach(([id, key]) => {
      const dl = $("#" + id);
      dl.innerHTML = "";
      (m[key] || []).forEach((v) => {
        const o = document.createElement("option");
        o.value = v;
        dl.appendChild(o);
      });
    });
  }

  function emailHtmlForPreview(html) {
    const logoData = `data:image/png;base64,${window.ASSETS.logoPng}`;
    return html.replace(/\{\{LOGO\}\}/g, logoData);
  }

  function emailHtmlForSend(html) {
    return html.replace(/\{\{LOGO\}\}/g, "cid:mmsd-logo");
  }

  function attachmentFor(mail, d, pdfBytes) {
    const list = [
      { name: "MMSD logo.png", content_base64: window.ASSETS.logoPng, content_id: "mmsd-logo" },
    ];
    if (mail.attachments.sheet) {
      list.push({
        name: `${d.policy || "Policy"} ${d.lastName || ""} Delivery Requirements.pdf`.trim(),
        content_base64: b64FromBytes(pdfBytes),
      });
    }
    if (mail.attachments.docusignInstructions) {
      list.push({ name: "DocuSign instructions 2026.pdf", content_base64: window.ASSETS.docusignInstructions });
    }
    if (mail.attachments.pacInstructions) {
      list.push({ name: "NEW PAC INSTRUCTIONS.pdf", content_base64: window.ASSETS.pacInstructions });
    }
    return list;
  }

  function buildEml(mail, html, attachments) {
    const boundary = "----=_Part_" + Math.random().toString(16).slice(2);
    const b64 = (txt) => {
      let out = "";
      for (let i = 0; i < txt.length; i += 57) out += btoa(txt.slice(i, i + 57)) + "\r\n";
      return out;
    };
    let eml = "";
    eml += `To: ${mail.to.join("; ")}\r\n`;
    if (mail.cc && mail.cc.length) eml += `Cc: ${mail.cc.join("; ")}\r\n`;
    eml += `Subject: ${mail.subject}\r\n`;
    eml += "MIME-Version: 1.0\r\n";
    eml += `Content-Type: multipart/related; boundary=\"${boundary}\"\r\n\r\n`;
    eml += `--${boundary}\r\nContent-Type: text/html; charset=\"utf-8\"\r\nContent-Transfer-Encoding: 7bit\r\n\r\n${html}\r\n`;
    attachments.forEach((a) => {
      eml += `--${boundary}\r\n`;
      eml += `Content-Type: application/octet-stream; name=\"${a.name}\"\r\n`;
      eml += "Content-Transfer-Encoding: base64\r\n";
      eml += `Content-Disposition: attachment; filename=\"${a.name}\"\r\n`;
      if (a.content_id) eml += `Content-ID: <${a.content_id}>\r\n`;
      eml += "\r\n" + b64(atob(a.content_base64)) + "\r\n";
    });
    eml += `--${boundary}--\r\n`;
    return eml;
  }

  async function sendOutlook(mail, d, mode) {
    if (!apiStatus) throw new Error("Local server is not running.");
    const body = {
      mode,
      to: mail.to,
      cc: mail.cc,
      bcc: mail.bcc || [],
      subject: mail.subject,
      html: emailHtmlForSend(mail.html),
      attachments: attachmentFor(mail, d, lastPdfBytes),
    };
    const r = await fetch("/api/outlook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
  }

  function cardForMail(mail, d) {
    const card = document.createElement("div");
    card.className = "card email";
    const previewHtml = emailHtmlForPreview(mail.html);
    const attachments = attachmentFor(mail, d, lastPdfBytes);
    card.innerHTML = `
      <h2>${mail.label} <span class="tag">${mail.id}</span></h2>
      <div class="meta">
        <span>To:</span><div>${mail.to.join("; ")}</div><button type="button" class="sm copyto">Copy</button>
        <span>Cc:</span><div>${(mail.cc || []).join("; ")}</div><button type="button" class="sm copycc">Copy</button>
        <span>Subject:</span><div>${mail.subject}</div><button type="button" class="sm copysub">Copy</button>
      </div>
      <div class="att">${attachments.map((a) => `<span>${a.name}</span>`).join("")}</div>
      <iframe></iframe>
      <div class="btns">
        <button type="button" class="sm eml">Download .eml</button>
        <button type="button" class="sm draft">Open Outlook draft</button>
        <button type="button" class="sm send">Send from shared mailbox</button>
      </div>`;
    card.querySelector("iframe").srcdoc = previewHtml;
    card.querySelector(".copyto").onclick = () => navigator.clipboard.writeText(mail.to.join("; "));
    card.querySelector(".copycc").onclick = () => navigator.clipboard.writeText((mail.cc || []).join("; "));
    card.querySelector(".copysub").onclick = () => navigator.clipboard.writeText(mail.subject);
    card.querySelector(".eml").onclick = () => {
      const blob = new Blob([buildEml(mail, emailHtmlForSend(mail.html), attachments)], { type: "message/rfc822" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${mail.id}.eml`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1200);
    };
    card.querySelector(".draft").onclick = async () => {
      try {
        await sendOutlook(mail, d, "draft");
        showToast("Opened draft in Outlook");
      } catch (e) {
        alert(`Could not open draft: ${e.message}`);
      }
    };
    card.querySelector(".send").onclick = async () => {
      if (!confirm("Send this email immediately from the shared mailbox?")) return;
      try {
        await sendOutlook(mail, d, "send");
        showToast("Email sent");
      } catch (e) {
        alert(`Could not send email: ${e.message}`);
      }
    };
    if (!apiStatus) {
      card.querySelector(".draft").disabled = true;
      card.querySelector(".send").disabled = true;
    } else if (!apiStatus.allowSend) {
      card.querySelector(".send").disabled = true;
    }
    return card;
  }

  async function generateAll() {
    if (!highlightInvalid()) {
      showToast("Please complete required fields.");
      return;
    }
    const d = buildData();
    saveContacts(d);
    loadContacts();

    const bytes = await window.DeliveryPdf.buildDeliveryPdf(d, window.ASSETS, window.PDFLib, window.fontkit);
    lastPdfBytes = bytes;
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    pdfFrame.src = url;

    const mails = [
      window.EMAIL_TEMPLATES.internalEmail(d),
      window.EMAIL_TEMPLATES.agencyEmail(d),
    ];
    lastEmails = mails;

    emailsWrap.innerHTML = "";
    mails.forEach((m) => emailsWrap.appendChild(cardForMail(m, d)));
    $("#step1").hidden = true;
    $("#step2").hidden = false;
    document.querySelector("[data-step='1']").classList.remove("active");
    document.querySelector("[data-step='2']").classList.add("active");
  }

  async function loadApiStatus() {
    try {
      const r = await fetch("/api/status");
      if (!r.ok) throw new Error("not running");
      apiStatus = await r.json();
      outlookStatus.textContent = `Outlook server connected. Shared mailbox: ${apiStatus.sharedMailbox}. ${apiStatus.allowSend ? "Direct send is enabled." : "Send is disabled in config.json (draft only)."}`;
    } catch (_) {
      apiStatus = null;
      outlookStatus.textContent = "Outlook server is not running. You can still download PDF and .eml files. To send directly from the shared mailbox, run: python server.py";
    }
  }

  function resetForm() {
    form.reset();
    form.deliveryDate.value = defaultDateIso();
    reqList.innerHTML = "";
    addReq("", false);
    refreshChips();
    renderSignerRows();
    updateTotals();
    updateReqNote();
  }

  function wireEvents() {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      generateAll().catch((err) => alert(`Generation failed: ${err.message || err}`));
    });
    ["premium", "tlir", "x1035", "freq", "deliveryDate"].forEach((n) =>
      form[n].addEventListener("input", () => {
        updateTotals();
        updateReqNote();
      }));
    form.method.forEach((r) => r.addEventListener("change", updateReqNote));
    $("#clearBtn").addEventListener("click", resetForm);
    $("#backBtn").addEventListener("click", () => {
      $("#step2").hidden = true;
      $("#step1").hidden = false;
      document.querySelector("[data-step='2']").classList.remove("active");
      document.querySelector("[data-step='1']").classList.add("active");
    });
    $("#dlPdf").addEventListener("click", () => {
      if (!lastPdfBytes) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([lastPdfBytes], { type: "application/pdf" }));
      a.download = `${(form.policy.value || "Policy").trim()} ${(form.lastName.value || "").trim()} Delivery Requirements.pdf`.replace(/\s+/g, " ").trim();
      a.click();
    });
    $("#dlAll").addEventListener("click", () => {
      $("#dlPdf").click();
      emailsWrap.querySelectorAll(".eml").forEach((b) => b.click());
    });
  }

  function init() {
    $("#logo").src = `data:image/png;base64,${window.ASSETS.logoPng}`;
    loadContacts();
    renderSignerRows();
    setupReqUi();
    wireEvents();
    resetForm();
    loadApiStatus();
  }

  init();
})();
