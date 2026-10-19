/*
  EMAIL TEMPLATES
  ---------------
  Edit this file to change recipients, subjects, wording or attachments.

  Every case produces TWO emails:
    Email 1 - "Policy Delivery request" to the New Business Policy Delivery team
              (PDF version or DocuSign version - wording taken from the buttons in the PDF form)
    Email 2 - "Policy issued" notice to the Agency (BGA) contact. Four versions:
                DocuSign + Monthly, DocuSign + other frequency,
                PDF      + Monthly, PDF      + other frequency

  `d` is the case data built by app.js (see buildData() there).
  Attachment keys: "sheet" (the generated Delivery Requirement Sheet),
                   "docusignInstructions", "pacInstructions".
*/
(function () {
  const FONT = "font-family:'Century Gothic',CenturyGothic,AppleGothic,sans-serif;font-size:11pt;color:#000;";
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const p = (html, extra = "") => `<div style="${FONT}margin:0;${extra}">${html}</div>`;
  const gap = () => p("<br>");
  const li = (html, extra = "") => `<li style="${FONT}line-height:1.4;margin:0 0 8px 0;${extra}">${html}</li>`;

  // ---------------------------------------------------------------- Email 1
  function internalEmail(d) {
    const docusign = d.method === "docusign";
    const instruction = docusign
      ? "Attached is a copy of the Delivery Requirement Sheet. Please send out via DocuSign."
      : "Attached is a copy of the Delivery Requirement Sheet. Please send out as a PDF to the Agency Contact.";

    let html =
      p(`Insured: ${esc(d.firstName)} ${esc(d.lastName)}`) + gap() +
      p("Hello team,") + gap() +
      p(esc(instruction)) + gap() +
      p(`Contact Name: ${esc(d.bgaName)}`) + gap() +
      p(`Email Address: ${esc(d.bgaEmail)}`) + gap() +
      p("Thank you!");

    if (docusign) {
      const cell = "border:1px solid #9aa9c2;padding:4px 8px;" + FONT;
      const head = cell + "background:#002e6b;color:#fff;font-weight:bold;";
      const rows = d.signers.map((r) =>
        `<tr><td style="${cell}font-weight:bold;">${esc(r.role)}</td><td style="${cell}">${esc(r.name)}</td>` +
        `<td style="${cell}">${esc(r.email)}</td><td style="${cell}">${esc(r.code)}</td></tr>`).join("");
      html += gap() +
        `<table style="border-collapse:collapse;" cellpadding="0" cellspacing="0">` +
        `<tr><th style="${head}">Role</th><th style="${head}">Name</th><th style="${head}">Email Address</th><th style="${head}">Access Code</th></tr>` +
        `<tr><td style="${cell}font-weight:bold;">Billing Mode</td><td style="${cell}" colspan="3">${esc(d.freq)}</td></tr>` +
        rows + `</table>`;
    }

    return {
      id: "internal-" + d.method,
      label: docusign ? "Policy Delivery request – DocuSign" : "Policy Delivery request – PDF",
      to: ["NewBusinessPolicyDelivery@massmutual.com"],
      cc: ["LifeScanToFile@MassMutual.com", d.amEmail],
      subject: `${d.policy} ${d.lastName} Delivery Requirements`,
      html,
      attachments: { sheet: true, docusignInstructions: false, pacInstructions: false },
    };
  }

  // ---------------------------------------------------------------- Email 2
  function agencyEmail(d) {
    const docusign = d.method === "docusign";
    const monthly = d.isMonthly;

    const banner =
      `<div style="text-align:center;line-height:1.4;background:#eef6ff;margin:0 0 25px 0;padding:10px;border:1px solid #c6dcff;border-radius:6px;">` +
      `<span style="font-family:'Century Gothic',CenturyGothic,AppleGothic,sans-serif;font-size:11pt;color:#002e6b;font-weight:700;">This email is being sent by the MMSD Case Management Team</span></div>`;

    const intro =
      p(`<b>Insured: </b>${esc(d.policy)} | ${esc(d.firstName)} ${esc(d.lastName)}`) + gap() +
      p(`<img alt="MassMutual Strategic Distributors" width="214" height="52" style="width:214px;height:52px;" src="{{LOGO}}">`) + gap() +
      p("Congratulations, this policy has been issued.") + gap() +
      p("Premiums are due from the policy effective date. The policy pages are generated overnight. " +
        "<b><u>You should receive the policy within 2 business days,</u>&nbsp;</b>and it will be sent by our Operations team.") + gap();

    let method;
    const bullets = [];
    if (docusign) {
      method =
        p("You will receive the MassMutual policy package via DocuSign for electronic signature. To ensure the information remains secure and confidential, " +
          "you will also be required to complete and pass authentication. When prompted, you will be asked to enter an access code.") + gap() +
        p("The DocuSign email will state that your passcode is the first 4 digits of your date of birth and the last 4 digits of your Social Security Number. " +
          "Please disregard and instead see below.") + gap();
      bullets.push(
        li("You, Agency Contact: <b>(Access Code: The Policy number)</b>" +
          `<ul style="list-style-type:circle;margin:12px 0 0 0;">` +
          li(`<span style="background:#ffff80;"><b><u>IMPORTANT:</u></b></span> Please see the attached instructions for Passcodes and signing order.`) +
          `</ul>`));
    } else {
      method =
        p("You will receive the MassMutual policy package as a PDF. Please review the attached Delivery Requirement Sheet, " +
          "have all requirements completed and signed, and return <b>all pages</b> of the delivery requirements.") + gap();
      bullets.push(
        li(`<b>Return delivery requirements to:</b> <a href="mailto:LIFEDELIVERYREQUIREMENTS@MASSMUTUAL.COM" style="color:#060479;"><b>LIFEDELIVERYREQUIREMENTS@MASSMUTUAL.COM</b></a>` +
          `<ul style="list-style-type:circle;margin:12px 0 0 0;">` +
          li(`<span style="background:#ffff80;"><b><u>IMPORTANT:</u></b></span> We are unable to accept the initial premium without all pages of the requirements returned.`) +
          `</ul>`));
    }

    if (d.balanceDue > 0) {
      bullets.push(li(`<b>Premium due:&nbsp; </b>The payor balance due of <b>${esc(d.balanceDueText)}</b> must be submitted with all pages of the requirements by <b>${esc(d.deliveryDate)}</b>. ` +
        `Please make all checks payable to MassMutual Financial Group.`));
    }
    if (monthly) {
      bullets.push(li(`<b>Monthly (EFT/PAC):&nbsp; </b>Please see the attached PAC instructions. If the policy is delivered after <b>${esc(d.deliveryDate)}</b>, an additional month's premium will be required.`));
    }
    bullets.push(li("<b>Frequency change requests:&nbsp; </b>Please email your Account Manager the request. This will not require a reissue.&nbsp;"));

    const tail =
      `<ul style="margin:0;list-style-type:disc;">${bullets.join("")}</ul>` + gap() +
      p(`<b>Account Manager: </b>${esc(d.amName)}`) + gap() +
      `<p style="line-height:1.4;margin:0 0 14px 0;${FONT}"><b>Questions or Next Steps?</b></p>` +
      `<p style="line-height:1.4;margin:0 0 15px 0;${FONT}">To provide the fastest service and ensure your request reaches the appropriate team:</p>` +
      `<ul style="margin:0 0 20px 0;padding-left:25px;">` +
      li("Case support, questions, and escalations, contact your <b>Account Manager</b>, cc'd on this email.") +
      li(`For real-time access to case status and outstanding requirements, visit the <a href="https://mmsd.massmutual.com/workbench/" style="color:#060479;"><b>MMSD Portal</b></a>`) +
      li(`Submit requirements to <a href="mailto:MMSD_Requirements@massmutual.com" style="color:#060479;"><b>MMSD_Requirements@massmutual.com</b></a> and copy your Account Manager.`) +
      li("MMSD New Business Team: <b>(800) 601-9983 - Option 4</b>", "margin:0;") +
      `</ul>` +
      `<p style="line-height:1.4;margin:18px 0 0 0;"><span style="font-family:'Century Gothic',CenturyGothic,AppleGothic,sans-serif;font-size:10pt;color:#555;"><b>Note:</b> ` +
      `<i>This message was sent from a shared mailbox. Replies may experience delays in review and response. Using the resources above will help ensure the quickest service.</i></span></p>`;

    const initialName = `${(d.firstName || "").charAt(0).toUpperCase()}. ${d.lastName}`;
    const subject = docusign
      ? `${d.policy} ${initialName} Secure Policy Issued Via DocuSign (Instructions attached)`
      : `${d.policy} ${initialName} Policy Issued Via PDF (Delivery Requirements attached)`;

    return {
      id: `agency-${d.method}-${monthly ? "monthly" : "other"}`,
      label: `Agency notice – ${docusign ? "DocuSign" : "PDF"} – ${monthly ? "Monthly" : "Annual / Quarterly / Semi-Annual / Single Pay"}`,
      to: [d.bgaEmail],
      cc: [d.amEmail],
      subject,
      html: banner + intro + method + tail,
      attachments: { sheet: !docusign, docusignInstructions: docusign, pacInstructions: monthly },
    };
  }

  window.EMAIL_TEMPLATES = { internalEmail, agencyEmail };
})();
