/* Roofing quote calculator — your catalogue
   Open index.html in a browser, then click "Edit products & prices"
   to change names, prices, and photos. You do not have to edit this file.

   If you prefer to edit here:
   - image: "images/photo.jpg"  (put the file in an images folder next to index.html)
   - coverWidthM is how many metres of roof ONE sheet covers
   - Sheet price = price per metre × the stock length the slope rounds up to
   - Keep this file in the same folder as index.html

   Edits made in the browser are saved in that browser and override this file
   until you click "Reset saved edits".
*/
const QUOTE_CONFIG = {
  version: 2,
  meta: { sample: false },
  theme: {
    accent: "#222222",
    ink: "#333333",
  },
  company: {
    name: "B&C McKeown LTD",
    phone: "02844 615148",
    email: "",
    logo: "",
    currencySymbol: "£",
    vatPercent: 20,
  },
  copy: {
    headline: "Quote Calculator",
    subheading: "Size roofing, decking, cladding, paving, kerbs, and steps from the B&C McKeown prices.",
    footer: "B&C McKeown LTD, Cloonagh Road, Downpatrick. Call 02844 615148. Product prices include VAT and match bcmckeown.net. Delivery is extra.",
    measurementNote: "Box profile and tile-effect sheets are priced at the length you enter. Sandwich panels, FRP and polycarbonate sheets round up to the next stock length.",
    sameSide: "Side 2 length matches side 1",
    rooflightNote: "Each rooflight replaces one metal sheet of the same length.",
    dripstopHelp: "Quantity is the total metres of metal sheet still on the quote (sheet count × ordered length).",
    dripstopBlocked: "Anti-condensation liner is not available for this profile or finish.",
    abutmentUnavailable: "Abutment flashings are only used on roof types that need them, such as a single slope.",
    bargeNote: "Quantities follow the eave-to-ridge measurement. Change the overlap or the piece length in the catalogue if you work this out differently.",
    ridgeNote: "The apex ridge follows the longer of the two side lengths. A single-slope roof uses a mono ridge along its length.",
    needProfile: "Select a profile above to see products for this step.",
    needType: "Select a roof type above to see which flashings apply.",
    basketNote: "Nothing is sent to a shop. This builds the quote on this device so you can print it, save it, or email it.",
    disclaimer: "Check quantities before you order. Prices include VAT but not delivery, and they are taken from the public prices on bcmckeown.net. Confirm the current price, stock and colour on the website or by phone before you buy.",
    emptyProducts: "Nothing here yet. Add products with Edit products & prices.",
  },
  steps: [
    { id: "job", kind: "job", title: "Choose a Calculator", hint: "Only products the website sells by the metre, or as pieces you can count from a size.", enabled: true, required: false },
    { id: "size", kind: "size", title: "Enter the Size", hint: "Quantities use the size and price published on the website.", enabled: true, required: false },
    { id: "job-colour", kind: "job-colour", title: "Select Colour", hint: "Swatches are sampled from the product photos on bcmckeown.net.", enabled: true, required: false },
    { id: "clad-wall", kind: "clad-wall", title: "Enter the wall", hint: "Add each wall on its own. Vertical and horizontal boards are counted differently.", enabled: true, required: false },
    { id: "extras", kind: "extras", title: "Full Product Range", hint: "Not shown in the quote. Gates, sheds, and other whole items stay in the catalogue file.", enabled: false, required: false },
    { id: "type", kind: "type", title: "Select Roof Type", hint: "An apex roof or a single slope.", enabled: true, required: false },
    { id: "profile", kind: "profile", title: "Choose Your Sheet", hint: "Metal sheets first, then clear sheets. Thickness is the next step.", enabled: true, required: false },
    { id: "finish", kind: "finish", title: "Choose Thickness", hint: "Prices are per metre, including VAT.", enabled: true, required: false },
    { id: "colour", kind: "colour", title: "Select Colour", hint: "Each block is the colour of that sheet.", enabled: true, required: false },
    { id: "measure", kind: "measure", title: "Enter Your Measurements", hint: "Use metres. Sheet quantity is worked out from these sizes.", enabled: true, required: false },
    { id: "dripstop", kind: "dripstop", title: "Add Dripstop", hint: "", enabled: false, required: false },
    { id: "rooflight", kind: "rooflight", title: "Add Rooflights", hint: "", enabled: false, required: false },
    { id: "barge", kind: "barge", title: "Add Corner Barge Flashings", hint: "", enabled: false, required: false },
    { id: "ridge", kind: "ridge", title: "Add Ridge Flashing", hint: "", enabled: false, required: false },
    { id: "abutment", kind: "abutment", title: "Add Abutment Flashings", hint: "", enabled: false, required: false },
    { id: "fixings", kind: "fixings", title: "Fixings", hint: "", enabled: false, required: false },
    { id: "review", kind: "review", title: "Review and Add to Basket", hint: "", enabled: true, required: true },
    { id: "export", kind: "export", title: "Export", hint: "Download this quote and the full catalogue as an Excel file.", enabled: true, required: false },
  ],
  measureFields: {
    apexA: {
      label: "A — Length Side 1 (metres)",
      help: "Eaves length of the first slope. Sheets are counted along this side.",
    },
    apexB: {
      label: "B — Span / Width (metres)",
      help: "Overall width of this part of the roof. Kept on the quote for reference. Sheet quantity uses the eaves length and the cover width.",
    },
    apexC: {
      label: "C — Eave to Ridge (metres)",
      help: "Sloping length from the eaves up to the ridge. Cut-to-size sheets use this length. Sandwich panels and polycarbonate round up to the next stock length.",
    },
    apexD: {
      label: "D — Length Side 2 (metres)",
      help: "Eaves length of the second slope. On a rectangular roof this is the same as side 1.",
    },
    monoA: {
      label: "A — Length (metres)",
      help: "Eaves length of the single slope. Sheets are counted along this side.",
    },
    monoB: {
      label: "B — Span / Width (metres)",
      help: "Horizontal width of the single slope, kept on the quote for reference.",
    },
    monoC: {
      label: "C — Eave to Ridge (metres)",
      help: "Sloping sheet length. Cut-to-size sheets use this length. Sandwich panels and polycarbonate round up to the next stock length.",
    },
  },
  rules: {
    stockLengthsM: [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8],
    flashingOverlapM: 0.15,
    vergeRunsPerSlope: 2,
    fixingsPerM2: 4,
    stitchersPerFlashing: 10,
  },
  roofTypes: [
    {
      id: "roof-apex",
      name: "Apex Roof",
      blurb: "Two slopes that meet at a ridge.",
      image: "",
      includeApex: true,
      includeMono: false,
      apexRidge: true,
      monoRidge: false,
      abutment: false,
    },
    {
      id: "roof-mono",
      name: "Single Slope",
      blurb: "One slope, with a mono ridge and an abutment along the high edge.",
      image: "",
      includeApex: false,
      includeMono: true,
      apexRidge: false,
      monoRidge: true,
      abutment: true,
    },
  ],
  dripstop: {
    name: "Non-drip is chosen as a thickness, not added on here",
    image: "",
    pricePerMetre: 0,
  },
  profiles: [
    {
      id: "profile-box",
      name: "24/1000 box profile",
      coverWidthM: 1,
      cutToSize: true,
      image: "images/profiles/box.svg?v=3",
      allowsDripstop: false,
      finishes: [
        { id: "box-05", name: "0.5mm", pricePerMetre: 7.1, allowsDripstop: false },
        { id: "box-05-nd", name: "0.5mm Non Drip", pricePerMetre: 10.383333, allowsDripstop: false },
        { id: "box-06", name: "0.6mm", pricePerMetre: 10.383333, allowsDripstop: false },
        { id: "box-06-nd", name: "0.6mm Non Drip", pricePerMetre: 12.566667, allowsDripstop: false },
      ],
      colours: [
        { id: "box-black", name: "Black", hex: "#1a2126", image: "" },
        { id: "box-green", name: "Juniper Green", hex: "#44503c", image: "" },
        { id: "box-grey", name: "Grey", hex: "#9a9a9a", image: "" },
      ],
      rooflights: [],
      barges: [],
      ridges: [],
      abutments: [],
    },
    {
      id: "profile-tile",
      name: "Tile effect",
      coverWidthM: 1,
      cutToSize: true,
      image: "images/profiles/tile.svg?v=5",
      allowsDripstop: false,
      finishes: [
        { id: "tile-05", name: "0.5mm", pricePerMetre: 12.5, allowsDripstop: false },
        { id: "tile-05-nd", name: "0.5mm Non Drip", pricePerMetre: 15, allowsDripstop: false },
        { id: "tile-06", name: "0.6mm", pricePerMetre: 15, allowsDripstop: false },
        { id: "tile-06-nd", name: "0.6mm Non Drip", pricePerMetre: 17.5, allowsDripstop: false },
      ],
      colours: [
        { id: "tile-green", name: "Juniper Green", hex: "#44503c", image: "" },
        { id: "tile-black", name: "Black", hex: "#1a2126", image: "" },
        { id: "tile-white", name: "White", hex: "#f4f4f4", image: "" },
        { id: "tile-anthracite", name: "Anthracite grey", hex: "#384045", image: "" },
      ],
      rooflights: [],
      barges: [],
      ridges: [],
      abutments: [],
    },
    {
      id: "profile-sandwich",
      name: "50mm rockwool sandwich panel",
      coverWidthM: 1,
      cutToSize: false,
      stockLengthsM: [3, 4, 5, 6, 7],
      image: "images/profiles/sandwich.svg?v=3",
      allowsDripstop: false,
      finishes: [
        { id: "sandwich-50", name: "50mm", pricePerMetre: 25, allowsDripstop: false },
      ],
      colours: [
        { id: "sandwich-9002", name: "White / grey RAL 9002", hex: "#e7ebda", image: "" },
      ],
      rooflights: [],
      barges: [],
      ridges: [],
      abutments: [],
    },
    {
      id: "profile-poly",
      name: "3mm polycarbonate, 688mm wide",
      coverWidthM: 0.688, // CHECK: shop lists "688 mm wide" (overall width?). Confirm the real cover width.
      cutToSize: false,
      stockLengthsM: [4, 5, 5.8],
      image: "images/profiles/flat.svg?v=3",
      allowsDripstop: false,
      finishes: [
        { id: "poly-3", name: "3mm", pricePerMetre: 16, allowsDripstop: false },
      ],
      colours: [
        { id: "poly-clear", name: "Clear", hex: "#d4ebf5", image: "" },
        { id: "poly-bronze", name: "Bronze tint", hex: "#6b4f32", image: "" },
      ],
      rooflights: [],
      barges: [],
      ridges: [],
      abutments: [],
    },
    {
      id: "profile-corr-clear",
      name: "Corrugated polycarbonate, clear",
      coverWidthM: 0.95,
      cutToSize: false,
      stockLengthsM: [2.8, 4, 5, 5.8],
      outOfStockLengthsM: [4, 5, 5.8], // only 2.8 m in stock on bcmckeown.net (7 Oct 2026)
      image: "images/profiles/corrugated.svg?v=3",
      allowsDripstop: false,
      finishes: [
        { id: "corr-clear", name: "1.2mm", pricePerMetre: 10.416667, allowsDripstop: false },
      ],
      colours: [
        { id: "corr-clear-colour", name: "Clear", hex: "#d4ebf5", image: "" },
      ],
      rooflights: [],
      barges: [],
      ridges: [],
      abutments: [],
    },
    {
      id: "profile-corr-bronze",
      name: "Corrugated polycarbonate, bronze",
      coverWidthM: 0.95,
      cutToSize: false,
      stockLengthsM: [3, 5.8],
      image: "images/profiles/corrugated-bronze.svg?v=3",
      allowsDripstop: false,
      finishes: [
        { id: "corr-bronze", name: "1.2mm", pricePerMetre: 10.416667, allowsDripstop: false },
      ],
      colours: [
        { id: "corr-bronze-colour", name: "Bronze", hex: "#6b4f32", image: "" },
      ],
      rooflights: [],
      barges: [],
      ridges: [],
      abutments: [],
    },
    {
      id: "profile-frp",
      name: "Clear FRP box profile",
      coverWidthM: 1,
      cutToSize: false,
      stockLengthsM: [2, 2.8, 3, 4, 5],
      image: "images/profiles/frp.svg?v=3",
      allowsDripstop: false,
      finishes: [
        { id: "frp-m", name: "Per metre", pricePerMetre: 8.333333, allowsDripstop: false },
      ],
      colours: [
        { id: "frp-clear", name: "Clear", hex: "#d4ebf5", image: "" },
      ],
      rooflights: [],
      barges: [],
      ridges: [],
      abutments: [],
    },
    {
      id: "profile-clear-box",
      name: "Clear polycarbonate box profile",
      coverWidthM: 1,
      cutToSize: false,
      stockLengthsM: [4],
      outOfStock: true, // out of stock on bcmckeown.net (7 Oct 2026)
      image: "images/profiles/clear-box.svg?v=3",
      allowsDripstop: false,
      finishes: [
        { id: "clear-box-4", name: "1.5mm, 4m sheets", pricePerMetre: 14.583333, allowsDripstop: false },
      ],
      colours: [
        { id: "clear-box-colour", name: "Clear", hex: "#d4ebf5", image: "" },
      ],
      rooflights: [],
      barges: [],
      ridges: [],
      abutments: [],
    },
    {
      id: "profile-diamond",
      name: "Diamond embossed polycarbonate",
      coverWidthM: 0.988,
      cutToSize: false,
      stockLengthsM: [5],
      image: "images/profiles/diamond.svg?v=4",
      allowsDripstop: false,
      finishes: [
        { id: "diamond-5", name: "2.8mm, 5m sheets", pricePerMetre: 25, allowsDripstop: false },
      ],
      colours: [
        { id: "diamond-clear", name: "Clear", hex: "#d4ebf5", image: "" },
      ],
      rooflights: [],
      barges: [],
      ridges: [],
      abutments: [],
    },
  ],
  fixings: [],
  extras: [
    {
      id: "extra-purlin",
      name: "Multibeam C purlin 210x65x1.5mm",
      image: "",
      profileIds: [],
      variants: [
        { id: "purlin-m", name: "Per metre, cut to length", price: 5, packSize: 1 },
      ],
    },
    {
      id: "extra-corr-clear",
      name: "Corrugated polycarbonate sheet",
      image: "",
      profileIds: [],
      variants: [
        { id: "corr-28", name: "2.8m", price: 29.166667, packSize: 1 },
        { id: "corr-40", name: "4m", price: 41.666667, packSize: 1 },
        { id: "corr-50", name: "5m", price: 52.083333, packSize: 1 },
        { id: "corr-58", name: "5.8m", price: 60.416667, packSize: 1 },
      ],
    },
  ],
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = QUOTE_CONFIG;
}
