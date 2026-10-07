"""Meeting checklist PDF. Run: python build-checklist.py"""
import json
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Table, TableStyle, Spacer, KeepTogether, HRFlowable,
)

RANGE_PATH = r"c:\Users\joshu\Downloads\roofing-quote-calculator\range.js"
OUT_PATH = r"c:\Users\joshu\Downloads\McKeown-product-checklist.pdf"

NAVY = colors.HexColor("#1e428b")
INK = colors.HexColor("#222222")
MUTED = colors.HexColor("#5c6570")
LINE = colors.HexColor("#c5ced9")
BAND = colors.HexColor("#e7f1fb")
ZEBRA = colors.HexColor("#f7f9fc")
AMBER = colors.HexColor("#fff6e8")

# id -> (in calculator, size we use, what the calculator does today)
KNOWN = {
    "light-grey-outdoor-porcelain-paving-20mm-400x800mm": (
        "Yes", "800 × 400 × 20 mm slab",
        "Whole slab. Not cut to a cheaper size. £36 each.",
    ),
    "grey-outdoor-porcelain-paving-20mm-400x800mm": (
        "Yes", "800 × 400 × 20 mm slab",
        "Whole slab. Not cut to a cheaper size. £36 each.",
    ),
    "black-composite-fencing-board-tongue-groove-3-6m-x-170mm": (
        "Yes", "3.6 m long, 170 mm cover",
        "Whole board only. A shorter run still takes a whole board.",
    ),
    "quartz-white-hollow-design-composite-decking-3-6m-x-140mm": (
        "Yes", "3.6 m × 140 mm cover",
        "Whole board only. Colour is a choice, same price.",
    ),
    "composite-decking-hollow-tube-design-woodgrain-dark-grey": (
        "Yes", "3.6 m × 140 mm cover",
        "Same board as the other decking colours. Whole board only.",
    ),
    "composite-decking-hollow-tube-design-woodgrain-teak": (
        "Yes", "3.6 m × 140 mm cover",
        "Same board as the other decking colours. Whole board only.",
    ),
    "composite-decking-hollow-tube-design-woodgrain-grey": (
        "Yes", "3.6 m × 140 mm cover",
        "Same board as the other decking colours. Whole board only.",
    ),
    "silver-grey-natural-granite-paving-900x600x30mm": (
        "Yes", "900 × 600 mm, 20 mm or 30 mm",
        "Whole slab. Thickness changes the price, not the size.",
    ),
    "clear-transparent-acrylic-sheet": (
        "Yes", "2.4 m × 1.2 m sheet",
        "Whole sheet only. Thickness is 4, 6 or 10 mm.",
    ),
    "diamond-embossed-corrugated-polycarbonate-sheet-5-metre-long": (
        "Yes", "5 m sheet, 988 mm cover",
        "Not cut. A shorter slope still takes the 5 m sheet.",
    ),
    "50mm-sandwich-panel-roofing-sheets-various-lengths-4-5-6-and-7-metres": (
        "Yes", "Stock lengths 3, 4, 5, 6, 7 m. 1 m cover",
        "Not cut to the exact length. Rounds up to the next stock length.",
    ),
    "wpc-edging-corner-trims-exterior-corners-90-degree-grey-black-teak-3-metre-lengths": (
        "Yes", "3 m length",
        "Whole length only. Grey, black and teak are the same price.",
    ),
    "multibeam-c-purlin-roof-beam-210x65mm": (
        "Yes", "210 × 65 × 1.5 mm, sold per metre",
        "Cut to the length ordered. £6 inc VAT per metre.",
    ),
    "polycarbonate-corrugated-clear-roofing-sheets-copy": (
        "Yes", "Stock 3 m and 5.8 m. About 950 mm cover",
        "Not cut. Sold in the stock lengths on the website.",
    ),
    "patio-lean-to-car-port-3mm-polycarbonate-roof-sheeting-5-metre-length-688mm-wide": (
        "Yes", "688 mm cover. Stock 4, 5, 5.8 m",
        "Not cut. Clear or bronze. Rounds up to the next stock length.",
    ),
    "polycarbonate-corrugated-clear-tinted-sheets": (
        "Yes", "Stock 2.8, 4, 5, 5.8 m. About 950 mm cover",
        "Not cut. Sold in those stock lengths.",
    ),
    "clear-polycarbonate-box-profile-sheets": (
        "Yes", "4 m sheet, 1 m cover",
        "Not cut. Sold as the 4 m sheet.",
    ),
    "clear-frp-fiber-reinforced-plastic-roofing-sheets-box-profile": (
        "Yes", "Stock 2, 2.8, 3, 4, 5 m. 1 m cover",
        "Not cut. Rounds up to the next stock length.",
    ),
    "natural-silver-g603-granite-cobble-stone-saw-cut-200x100x30mm": (
        "Yes", "200 × 100 × 30 mm, priced per m²",
        "Sold by the square metre (£48). Not cut to a cheaper price.",
    ),
    "roof-cladding-sheets-cut-to-size-0-5mm-non-drip-black-green-and-white": (
        "Yes", "1 m cover. Priced per metre",
        "Cut to the length ordered. Grey, black, green. 0.5 or 0.6 mm, with or without non-drip.",
    ),
    "roofing-sheets-tile-effect-metre-coverage-cut-to-size": (
        "Yes", "1 m cover. Priced per metre",
        "Cut to the length ordered. 0.5 or 0.6 mm, with or without non-drip.",
    ),
    "snow-grey-granite": (
        "Yes", "600 × 300 × 30 mm slab",
        "Whole slab only. £48 each.",
    ),
    "natural-split-granite-kerb-stone": (
        "Yes", "1200 × 225 × 75 mm",
        "Whole kerb. The run rounds up to the next kerb.",
    ),
    "natural-granite-kerb-stone": (
        "Yes", "900 × 255 × 300 mm",
        "Whole kerb. The run rounds up to the next kerb.",
    ),
    "granite-bullnose-step-1000x400x40mm-flammed-finish": (
        "Yes", "1000 × 400 mm, 30 / 40 / 50 mm",
        "Whole tread. A wider step needs another whole piece.",
    ),
    "granite-paving-g603-silver-600x300x30mm": (
        "Yes", "600 × 300 × 30 mm slab",
        "Whole slab only. £36 each.",
    ),
    "granite-steps-silver-g603-1000x350x30mm": (
        "Yes", "1000 × 400 × 30 mm",
        "Whole tread. A wider step needs another whole piece.",
    ),
    "granite-kerbs-g603-silver-1000x150x90mm": (
        "Yes", "1000 × 150 × 90 mm",
        "Whole kerb. The run rounds up to the next kerb.",
    ),
    "luxclad-wood-grain-composite-wall-panel-dark-grey-copy": (
        "Yes", "3 m long, 125 mm cover",
        "Whole board. Teak wood grain is 3 m. Not cut to a lower price.",
    ),
    "wood-grain-wall-panel-dark-grey": (
        "Yes", "2.9 m long, 125 mm cover",
        "Whole board. Dark grey wood grain is 2.9 m, not 3 m.",
    ),
    "wood-grain-wall-panel": (
        "Yes", "2.9 m long, 125 mm cover",
        "Whole board. Grey wood grain is 2.9 m, not 3 m.",
    ),
    "composite-slatted-wall-cladding-black": (
        "Yes", "3 m long, 200 mm cover",
        "Whole board. £24 is one board. The 219 mm on the drawing is the panel width, not the cover.",
    ),
    "composite-slatted-wall-cladding-black-copy": (
        "Yes", "3 m long, 200 mm cover",
        "Whole board. Teak with black centre. Same price as the other slatted colours.",
    ),
    "composite-slatted-wall-panel-grey": (
        "Yes", "3 m long, 200 mm cover",
        "Whole board. Same price as the other slatted colours.",
    ),
    "composite-slatted-wall-panel": (
        "Yes", "3 m long, 200 mm cover",
        "Whole board. Same price as the other slatted colours.",
    ),
    "natural-granite-steps-sold-300x255x900mm-flamed": (
        "Yes", "900 × 300 × 255 mm",
        "Whole step. Not cut to a shorter price.",
    ),
    "granite-step-riser-1000x150x30mm-silver-g603": (
        "Yes", "1000 × 150 × 30 mm",
        "Whole riser. Not cut to a shorter price.",
    ),
    "composite-step-board-3600x310x55mm": (
        "Yes", "3600 × 310 × 55 mm",
        "Whole board. A wider step needs another whole board.",
    ),
    "silver-g603-granite-radius-kerbs-98x90x115mm": (
        "No", "98 × 90 × 115 mm each",
        "Left out. Fixed piece, not a straight run we can measure.",
    ),
    "silver-grey-granite-cobbles-100x100x50mm-natural-split": (
        "No", "100 × 100 × 50 mm. Cover not on the site",
        "Left out. Please say if it is sold each or by the m².",
    ),
    "driveway-patio-yellow-granite-tumbled-200x100x50mm-and-100x100x50mm": (
        "No", "Mixed 200 × 100 and 100 × 100. No cover on the site",
        "Left out. Please say how a square metre is made up.",
    ),
    "granite-bullnose-step-corners": (
        "No", "Sold each, 30 / 40 / 50 mm",
        "Left out. Fixed piece, not sized from a width.",
    ),
    "granite-gate-posts-natural-stone-with-pointed-top": (
        "No", "Sold each",
        "Left out. Fixed piece.",
    ),
    "rustic-slate-wall-cladding": (
        "No", "Size not on the calculator",
        "Left out. Please give the piece size and how it is sold.",
    ),
    "antique-slatted-composite-fencing-1-8mx1-8m-6ftx6ft": (
        "No", "1.8 × 1.8 m bay kit",
        "Left out. Ready-made bay, not loose boards.",
    ),
    "composite-fencing": (
        "No", "Listed at £240 each",
        "Left out. Treated as a ready-made bay, not loose boards.",
    ),
}


def inc_vat(ex):
    return round(float(ex) * 1.2 + 1e-9, 2)


def money(ex):
    return f"£{inc_vat(ex):.2f}"


def load_products():
    text = open(RANGE_PATH, encoding="utf-8").read()
    data = json.loads(text[text.index("["):].rstrip().rstrip(";"))
    for item in data:
        item["name"] = item["name"].replace("Â²", "²").replace("\u00c2\u00b2", "²")
    return data


def price_text(item):
    parts = []
    for variant in item["variants"]:
        label = variant["name"]
        price = money(variant["price"])
        if label.lower() in ("each", "single"):
            parts.append(price + " each")
        else:
            parts.append(f"{label} {price}")
    return "<br/>".join(parts)


def fallback(item):
    name = item["name"].lower()
    cat = item["category"].lower()
    if "gate" in name or "shed" in cat or "garden room" in name or "v mesh" in name:
        return (
            "No",
            "Fixed kit or building",
            "Left out. One price for the kit. Not cut and not sized from a measurement.",
        )
    return (
        "No",
        "Not set",
        "Not in the calculator yet. Please say if it can be cut, and how it is sold.",
    )


def row_for(item):
    known = KNOWN.get(item["id"]) or fallback(item)
    return known


def main():
    products = load_products()
    products.sort(key=lambda item: (item["category"], item["name"].lower()))

    doc = SimpleDocTemplate(
        OUT_PATH,
        pagesize=landscape(A4),
        leftMargin=12 * mm,
        rightMargin=12 * mm,
        topMargin=12 * mm,
        bottomMargin=12 * mm,
        title="Product checklist — B&C McKeown LTD",
        author="B&C McKeown LTD",
    )

    name = ParagraphStyle("name", fontName="Times-Bold", fontSize=9, leading=11, textColor=INK)
    body = ParagraphStyle("body", fontName="Times-Roman", fontSize=8, leading=10, textColor=INK)
    small = ParagraphStyle("small", fontName="Times-Roman", fontSize=7.5, leading=9.5, textColor=INK)
    head = ParagraphStyle("head", fontName="Times-Bold", fontSize=7.5, leading=9, textColor=colors.white, alignment=TA_LEFT)
    cat = ParagraphStyle("cat", fontName="Times-Bold", fontSize=9, leading=11, textColor=NAVY)
    title = ParagraphStyle("title", fontName="Times-Bold", fontSize=16, leading=18, textColor=NAVY)
    sub = ParagraphStyle("sub", fontName="Times-Roman", fontSize=9, leading=12, textColor=INK)
    tick = ParagraphStyle("tick", fontName="Times-Roman", fontSize=7.5, leading=10, textColor=INK)

    story = []
    story.append(Paragraph("B&amp;C McKeown LTD", title))
    story.append(Paragraph("Product checklist for the quote calculator", ParagraphStyle(
        "h2", fontName="Times-Bold", fontSize=12, leading=14, textColor=INK,
    )))
    story.append(Spacer(1, 2 * mm))
    story.append(Paragraph(
        "For the meeting. Tick one answer on each row. The words already printed are what the calculator does today, "
        "using the public prices on bcmckeown.net. Prices below include VAT. If a price, size, or rule is wrong, write the right one in Notes.",
        sub,
    ))
    story.append(Spacer(1, 1.5 * mm))
    story.append(Paragraph("Date ______________ &nbsp;&nbsp;&nbsp; Filled in by ______________ &nbsp;&nbsp;&nbsp; Phone 02844 615148", sub))
    story.append(Spacer(1, 3 * mm))

    general = [
        [Paragraph("<b>Answer these once. They apply to the whole calculator.</b>", body)],
        [Paragraph(
            "1. If the customer does not ask for spare material, what extra should we add? "
            "&nbsp;&nbsp; [ &nbsp; ] None &nbsp;&nbsp; [ &nbsp; ] 10% &nbsp;&nbsp; [ &nbsp; ] Other ______ "
            "&nbsp;&nbsp; Today the calculator uses 10% on decking, paving, cladding and trim, and none on fence boards and acrylic.",
            small,
        )],
        [Paragraph(
            "2. Doors and windows on cladding. "
            "&nbsp;&nbsp; [ &nbsp; ] Leave them out, so fewer boards are ordered "
            "&nbsp;&nbsp; [ &nbsp; ] Ignore them, so the full wall is ordered "
            "&nbsp;&nbsp; Today, entering a door or window reduces the board count. Boards are still sold at full length.",
            small,
        )],
        [Paragraph(
            "3. A short length. "
            "&nbsp;&nbsp; [ &nbsp; ] Still charge for the whole piece "
            "&nbsp;&nbsp; [ &nbsp; ] Cut it and charge only for the length used "
            "&nbsp;&nbsp; [ &nbsp; ] It depends on the product — use the ticks in the table",
            small,
        )],
        [Paragraph(
            "4. Delivery. &nbsp;&nbsp; [ &nbsp; ] Leave it off the quote &nbsp;&nbsp; [ &nbsp; ] Add it. How is it priced? ________________________________",
            small,
        )],
    ]
    general_table = Table(general, colWidths=[273 * mm])
    general_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BAND),
        ("BACKGROUND", (0, 1), (-1, -1), colors.white),
        ("BOX", (0, 0), (-1, -1), 0.6, NAVY),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    story.append(general_table)
    story.append(Spacer(1, 4 * mm))
    story.append(Paragraph(
        "On each product, tick <b>one</b> of: cut to the size ordered, whole piece only, or round up to the next stock length. "
        "Then tick whether the price and the size are right.",
        sub,
    ))
    story.append(Spacer(1, 2 * mm))

    header = [
        Paragraph("Product", head),
        Paragraph("In the calculator now", head),
        Paragraph("Price on the site, inc VAT", head),
        Paragraph("Size the calculator uses", head),
        Paragraph("What it does today", head),
        Paragraph("Tick one", head),
        Paragraph("Price right?", head),
        Paragraph("Size right?", head),
        Paragraph("Notes — write the correction", head),
    ]
    widths = [42 * mm, 18 * mm, 32 * mm, 32 * mm, 46 * mm, 32 * mm, 16 * mm, 16 * mm, 39 * mm]

    data = [header]
    spans = []
    category = None
    row_index = 1
    for item in products:
        if item["category"] != category:
            category = item["category"]
            data.append([Paragraph(category, cat)] + [""] * 8)
            spans.append(row_index)
            row_index += 1
        in_calc, size, today = row_for(item)
        ticks = Paragraph(
            "[ &nbsp; ] Cut to size<br/>[ &nbsp; ] Whole piece only<br/>[ &nbsp; ] Next stock length",
            tick,
        )
        data.append([
            Paragraph(item["name"], name),
            Paragraph(in_calc, ParagraphStyle("mid", parent=body, alignment=TA_CENTER)),
            Paragraph(price_text(item), small),
            Paragraph(size, small),
            Paragraph(today, small),
            ticks,
            Paragraph("[ &nbsp; ] Yes<br/>[ &nbsp; ] No", tick),
            Paragraph("[ &nbsp; ] Yes<br/>[ &nbsp; ] No", tick),
            Paragraph(" ", small),
        ])
        row_index += 1

    table = Table(data, colWidths=widths, repeatRows=1)
    style_cmds = [
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Times-Bold"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.3, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("BACKGROUND", (5, 1), (7, -1), colors.HexColor("#fffdf8")),
    ]
    zebra_on = False
    for i in range(1, len(data)):
        if i in spans:
            style_cmds.append(("SPAN", (0, i), (-1, i)))
            style_cmds.append(("BACKGROUND", (0, i), (-1, i), BAND))
            zebra_on = False
        elif zebra_on:
            style_cmds.append(("BACKGROUND", (0, i), (4, i), ZEBRA))
            style_cmds.append(("BACKGROUND", (8, i), (8, i), ZEBRA))
            zebra_on = not zebra_on
        else:
            zebra_on = not zebra_on
    # The zebra toggle above is messy because I flip twice. Rebuild zebra cleanly.
    style_cmds = [cmd for cmd in style_cmds if not (isinstance(cmd, tuple) and cmd[0] == "BACKGROUND" and cmd[1][0] in (0, 8) and cmd[1][1] != 0 and cmd[2][0] in (4, 8))]
    alt = False
    for i in range(1, len(data)):
        if i in spans:
            alt = False
            continue
        if alt:
            style_cmds.append(("BACKGROUND", (0, i), (4, i), ZEBRA))
            style_cmds.append(("BACKGROUND", (8, i), (8, i), ZEBRA))
        alt = not alt

    table.setStyle(TableStyle(style_cmds))
    story.append(table)
    story.append(Spacer(1, 4 * mm))

    blanks = [[Paragraph("<b>Anything missing, or a product that should come off the calculator</b>", body)]]
    for n in range(1, 6):
        blanks.append([Paragraph(f"{n}. _______________________________________________________________________________________________", small)])
    blank_table = Table(blanks, colWidths=[273 * mm])
    blank_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BAND),
        ("BOX", (0, 0), (-1, -1), 0.6, NAVY),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(KeepTogether([Spacer(1, 2 * mm), blank_table]))

    def footer(canvas, doc_):
        canvas.saveState()
        canvas.setStrokeColor(NAVY)
        canvas.setLineWidth(1.5)
        canvas.line(12 * mm, landscape(A4)[1] - 8 * mm, landscape(A4)[0] - 12 * mm, landscape(A4)[1] - 8 * mm)
        canvas.setFont("Times-Roman", 8)
        canvas.setFillColor(MUTED)
        canvas.drawString(12 * mm, 6 * mm, "B&C McKeown LTD  ·  Quote calculator checklist  ·  Prices include VAT")
        canvas.drawRightString(landscape(A4)[0] - 12 * mm, 6 * mm, f"Page {doc_.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    print(OUT_PATH)


if __name__ == "__main__":
    main()
