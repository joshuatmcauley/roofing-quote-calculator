// Builds the quote PDF in the browser (jsPDF + autotable, loaded on demand by app.js)
// and returns it as base64 so it can be attached to the email.
(function () {
  const GREEN = [51, 86, 26];
  const INK = [27, 31, 28];
  const MUTED = [107, 114, 109];
  const RULE = [229, 231, 228];

  function loadImage(url) {
    return fetch(url).then((r) => (r.ok ? r.blob() : Promise.reject(new Error("logo")))).then((blob) => new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => {
        const img = new Image();
        img.onload = () => resolve({ data: fr.result, w: img.width, h: img.height });
        img.onerror = reject;
        img.src = fr.result;
      };
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    }));
  }

  window.buildQuotePdf = async function (q) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const M = 40;
    const R = W - M;

    // top rule + logo + reference block
    doc.setFillColor(...GREEN);
    doc.rect(0, 0, W, 6, "F");
    try {
      const logo = await loadImage("email-logo.png");
      const lw = 190;
      doc.addImage(logo.data, "PNG", M, 30, lw, lw * (logo.h / logo.w));
    } catch (e) {
      doc.setFont("helvetica", "bold").setFontSize(18).setTextColor(...INK).text(q.company.name || "B&C McKeown", M, 50);
    }
    doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(...GREEN).text("QUOTE", R, 38, { align: "right" });
    let ry = 52;
    if (q.ref) { doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(...INK).text(q.ref, R, ry, { align: "right" }); ry += 14; }
    doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(...MUTED).text(q.date || "", R, ry, { align: "right" });

    // banner
    doc.setFillColor(...GREEN);
    doc.rect(0, 84, W, 28, "F");
    doc.setFont("helvetica", "bold").setFontSize(13).setTextColor(255, 255, 255).text(q.headline || "Roofing quote", M, 103);

    // customer + overview
    let y = 138;
    const c = q.customer || {};
    if (c.name || c.email || c.phone) {
      doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...MUTED).text("CUSTOMER", M, y);
      y += 14;
      doc.setFont("helvetica", "bold").setFontSize(12).setTextColor(...INK);
      if (c.name) { doc.text(c.name, M, y); y += 15; }
      doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(...INK);
      if (c.email) { doc.text(c.email, M, y); y += 13; }
      if (c.phone) { doc.text(c.phone, M, y); y += 13; }
      y += 6;
    }
    if (q.overview && q.overview.length) {
      doc.setFont("helvetica", "normal").setFontSize(9.5).setTextColor(...MUTED);
      const lines = doc.splitTextToSize(q.overview.join("  ·  "), R - M);
      doc.text(lines, M, y);
      y += lines.length * 12 + 8;
    }

    // items table
    doc.autoTable({
      startY: y,
      margin: { left: M, right: M, bottom: 70 },
      head: [["ITEM", "QTY", "UNIT", "TOTAL"]],
      body: q.lines.map((l) => [l.detail ? l.name + "\n" + l.detail : l.name, l.qty, l.unit, l.total]),
      theme: "plain",
      styles: { font: "helvetica", fontSize: 9.5, textColor: INK, cellPadding: { top: 7, bottom: 7, left: 6, right: 6 }, lineColor: RULE, lineWidth: 0 },
      headStyles: { fontSize: 8, fontStyle: "bold", textColor: MUTED, lineColor: GREEN },
      columnStyles: { 0: { cellWidth: "auto" }, 1: { cellWidth: 70 }, 2: { cellWidth: 65, halign: "right" }, 3: { cellWidth: 70, halign: "right", fontStyle: "bold" } },
      didParseCell: (d) => {
        if (d.section === "head" && d.column.index >= 2) d.cell.styles.halign = "right";
        if (d.section === "body" && d.column.index === 0) d.cell.styles.fontStyle = "bold";
      },
      // item name stays bold; the detail line under it is drawn muted and smaller
      willDrawCell: (d) => {
        if (d.section === "body" && d.column.index === 0 && Array.isArray(d.cell.text) && d.cell.text.length > 1) {
          d.cell._detail = d.cell.text.slice(1);
          d.cell.text = [d.cell.text[0]];
        }
      },
      didDrawCell: (d) => {
        const { x, y: cy, width, height } = d.cell;
        if (d.cell._detail) {
          doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(...MUTED);
          doc.text(d.cell._detail, x + 6, cy + 7 + 9.5 * 1.15, { baseline: "top" });
        }
        doc.setLineWidth(d.section === "head" ? 1.5 : 0.5);
        doc.setDrawColor(...(d.section === "head" ? GREEN : RULE));
        doc.line(x, cy + height, x + width, cy + height);
      },
    });
    y = doc.lastAutoTable.finalY + 18;

    // totals
    if (y > H - 190) { doc.addPage(); y = 50; }
    const tx = R - 220;
    const row = (label, value, bold) => {
      doc.setFont("helvetica", bold ? "bold" : "normal").setFontSize(bold ? 12 : 10).setTextColor(...(bold ? INK : MUTED));
      doc.text(label, tx, y);
      doc.setTextColor(...INK).text(value, R, y, { align: "right" });
      y += bold ? 0 : 16;
    };
    row("Subtotal (ex. VAT)", q.totals.exVat);
    row(`VAT (${q.totals.vatPercent}%)`, q.totals.vat);
    doc.setDrawColor(...GREEN).setLineWidth(1.5).line(tx, y - 6, R, y - 6);
    y += 12;
    row("Total (inc. VAT)", q.totals.incVat, true);
    y += 26;

    // notes
    if (q.notes) {
      const lines = doc.splitTextToSize(q.notes, R - M - 24);
      const h = lines.length * 12 + 34;
      if (y + h > H - 80) { doc.addPage(); y = 50; }
      doc.setFillColor(244, 246, 243).roundedRect(M, y, R - M, h, 6, 6, "F");
      doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(...INK).text("Notes", M + 12, y + 18);
      doc.setFont("helvetica", "normal").setFontSize(10).text(lines, M + 12, y + 33);
      y += h + 16;
    }
    if (q.disclaimer) {
      const lines = doc.splitTextToSize(q.disclaimer, R - M);
      if (y + lines.length * 11 > H - 60) { doc.addPage(); y = 50; }
      doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(...MUTED).text(lines, M, y);
    }

    // footer on every page
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setDrawColor(...RULE).setLineWidth(0.5).line(M, H - 44, R, H - 44);
      doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(...INK).text(q.company.name || "", M, H - 28);
      const bits = [q.company.phone, q.company.email].filter(Boolean).join("  ·  ");
      doc.setFont("helvetica", "normal").setTextColor(...MUTED).text(bits, M + doc.getTextWidth(q.company.name || "") + 10, H - 28);
      if (pages > 1) doc.text(`Page ${i} of ${pages}`, R, H - 28, { align: "right" });
    }
    return doc.output("datauristring").split(",")[1];
  };
})();
