// Hand-written Indian local-shop catalogue (English + Hindi) for the mock seed. All shops/brands/prices are MOCK data.
// A family expands into products via the cross product of its dimensions: [brand] x variant dims.
//   dim entry = "500g"  or  ["Sky Blue", "आसमानी नीला"]  (English label, Hindi label)

export function rng(seed) {                       // deterministic PRNG (mulberry32) so every run gives the same data
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const r = { next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    float: (lo, hi) => lo + next() * (hi - lo),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    shuffle: (arr) => { const o = [...arr]; for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; } return o; } };
  r.sample = (arr, n) => r.shuffle(arr).slice(0, n);
  return r;
}

const R = (a, b, s = 1, f = (x) => x) => { const o = []; for (let x = a; x <= b + 1e-9; x += s) o.push(f(+x.toFixed(2))); return o; };
const COL = { "Brilliant White": "चमकदार सफेद", Ivory: "आइवरी", "Sky Blue": "आसमानी नीला", Peach: "पीच", "Lemon Yellow": "नींबू पीला",
  "Light Green": "हल्का हरा", Grey: "स्लेटी", Pink: "गुलाबी", Black: "काला", Red: "लाल", Blue: "नीला", Green: "हरा", Yellow: "पीला",
  Brown: "भूरा", White: "सफेद", Orange: "नारंगी", Purple: "बैंगनी", Silver: "सिल्वर" };
const col = (...names) => names.map((n) => [n, COL[n]]);
const SZ = ['6"', '8"', '10"', '12"'];

// F(en, hi, unit, price[lo,hi] in rupees, dims[], opts)
const F = (en, hi, unit, price, dims = [[""]], o = {}) => ({ en, hi, unit, price, dims, brands: o.brands ?? [], thr: o.thr ?? 5, alias: o.alias ?? [], frac: o.frac ?? false });

const hardware = [
  F("Claw Hammer", "क्लॉ हथौड़ा", "pcs", [120, 480], [["250g", "300g", "400g", "450g", "500g", "600g", "750g", "1kg"]], { brands: ["Taparia", "Stanley", "Eastman", "Jhalani"], alias: ["hammer", "hathoda"] }),
  F("Ball Peen Hammer", "बॉल पीन हथौड़ा", "pcs", [150, 500], [["250g", "500g", "750g", "1kg"]], { brands: ["Taparia", "Eastman"], alias: ["hammer", "hathoda"] }),
  F("Phillips Screwdriver", "फिलिप्स पेचकस", "pcs", [40, 160], [["75mm", "100mm", "125mm", "150mm", "200mm", "250mm"]], { brands: ["Taparia", "Stanley", "Eastman"], thr: 8, alias: ["screwdriver", "pechkas"] }),
  F("Flat Screwdriver", "सादा पेचकस", "pcs", [40, 160], [["75mm", "100mm", "125mm", "150mm", "200mm", "250mm"]], { brands: ["Taparia", "Stanley", "Eastman"], thr: 8, alias: ["screwdriver", "pechkas"] }),
  F("Screwdriver Set", "पेचकस सेट", "set", [180, 900], [["6 pcs", "8 pcs", "11 pcs", "16 pcs", "32 pcs"]], { brands: ["Taparia", "Stanley", "Bosch"], alias: ["screwdriver", "pechkas"] }),
  F("Combination Spanner", "कॉम्बिनेशन पाना", "pcs", [40, 450], [R(6, 32).filter((x) => ![20, 23, 25, 26, 28, 29, 31].includes(x)).map((x) => x + "mm")], { brands: ["Taparia", "Eastman", "Jhalani"], thr: 6, alias: ["spanner", "pana"] }),
  F("Adjustable Wrench", "एडजस्टेबल रिंच", "pcs", [150, 700], [['6"', '8"', '10"', '12"', '15"']], { brands: ["Taparia", "Stanley"], alias: ["wrench", "pana"] }),
  F("Combination Pliers", "प्लास", "pcs", [120, 350], [['6"', '7"', '8"']], { brands: ["Taparia", "Stanley", "Eastman"], alias: ["pliers", "plas"] }),
  F("Nose Pliers", "लंबी नोक प्लास", "pcs", [110, 300], [['6"', '8"']], { brands: ["Taparia", "Eastman"], alias: ["pliers", "plas"] }),
  F("Cutting Pliers", "कटिंग प्लास", "pcs", [110, 300], [['6"', '8"']], { brands: ["Taparia", "Eastman"], alias: ["pliers", "plas"] }),
  F("Hacksaw Frame", "हैकसॉ फ्रेम", "pcs", [90, 260], [["12\" Adjustable", "12\" Fixed"]], { brands: ["Taparia", "Eastman"], alias: ["saw", "aari"] }),
  F("Hacksaw Blade", "हैकसॉ ब्लेड", "pcs", [10, 40], [["12\" 18TPI", "12\" 24TPI", "12\" 32TPI"]], { brands: ["Eastman", "Addtool", "Taparia"], thr: 20, alias: ["saw", "aari"] }),
  F("Hand Saw", "हाथ की आरी", "pcs", [180, 520], [['14"', '16"', '18"', '20"', '22"', '24"']], { brands: ["Taparia", "Stanley"], alias: ["saw", "aari"] }),
  F("Measuring Tape", "नापने का फीता", "pcs", [60, 650], [["3m", "5m", "7.5m", "10m", "15m", "30m"]], { brands: ["Stanley", "Freemans", "Taparia"], alias: ["tape", "naap"] }),
  F("Wood Chisel", "छेनी", "pcs", [60, 320], [["6mm", "10mm", "12mm", "16mm", "19mm", "25mm", "32mm"]], { brands: ["Taparia", "Eastman"], alias: ["chisel", "chheni"] }),
  F("Flat File", "रेती", "pcs", [80, 330], [['6"', '8"', '10"', '12"']], { brands: ["Taparia", "Eastman"], alias: ["file", "reti"] }),
  F("HSS Drill Bit", "ड्रिल बिट", "pcs", [15, 220], [R(1, 13, 0.5).filter((x) => x <= 7 || Number.isInteger(x)).map((x) => x + "mm")], { brands: ["Bosch", "Taparia", "Addtool"], thr: 10, alias: ["drill", "bit"] }),
  F("Masonry Drill Bit", "दीवार ड्रिल बिट", "pcs", [40, 240], [["5mm", "6mm", "8mm", "10mm", "12mm", "14mm"]], { brands: ["Bosch", "Addtool"], thr: 10, alias: ["drill", "bit"] }),
  F("Wood Screw", "लकड़ी का पेंच", "box", [30, 190], [['1/2"', '3/4"', '1"', '1.5"', '2"', '2.5"', '3"'], ["Gauge 6", "Gauge 8", "Gauge 10"]], { thr: 10, alias: ["screw", "pench"] }),
  F("Hex Bolt", "बोल्ट", "pack", [20, 260], [["M6", "M8", "M10", "M12"], ["25mm", "40mm", "50mm", "75mm", "100mm"]], { thr: 10, alias: ["bolt", "bolt"] }),
  F("Hex Nut", "नट", "pack", [15, 120], [["M6", "M8", "M10", "M12", "M14", "M16"]], { thr: 15, alias: ["nut"] }),
  F("Flat Washer", "वॉशर", "pack", [10, 80], [["M6", "M8", "M10", "M12", "M14", "M16"]], { thr: 15, alias: ["washer"] }),
  F("Iron Nail", "लोहे की कील", "kg", [70, 110], [['1"', '1.5"', '2"', '2.5"', '3"', '4"', '5"', '6"']], { frac: true, thr: 10, alias: ["nail", "keel"] }),
  F("Wall Plug", "वॉल प्लग", "pack", [20, 90], [["6mm", "8mm", "10mm", "12mm"]], { brands: ["Fischer", "Addtool"], thr: 15, alias: ["plug", "rawal plug"] }),
  F("Door Hinge", "दरवाज़े का कब्ज़ा", "pair", [30, 380], [['2"', '3"', '4"', '5"', '6"'], col("Brown", "Silver", "Black")], { thr: 10, alias: ["hinge", "kabza"] }),
  F("Tower Bolt", "टावर बोल्ट", "pcs", [40, 420], [['4"', '6"', '8"', '10"', '12"'], [["Brass", "पीतल"], ["Stainless Steel", "स्टील"]]], { alias: ["bolt", "kundi"] }),
  F("Padlock", "ताला", "pcs", [90, 1400], [["40mm", "50mm", "65mm", "75mm", "90mm"]], { brands: ["Godrej", "Harrison", "Link"], thr: 6, alias: ["lock", "tala"] }),
  F("Sandpaper", "रेगमाल", "sheet", [6, 28], [["Grit 60", "Grit 80", "Grit 100", "Grit 120", "Grit 150", "Grit 180", "Grit 220", "Grit 320", "Grit 400", "Grit 600"]], { brands: ["Cumi", "Norton"], thr: 20, alias: ["sandpaper", "regmal"] }),
  F("Paint Brush", "पेंट ब्रश", "pcs", [20, 240], [['0.5"', '1"', '1.5"', '2"', '3"', '4"']], { brands: ["Asian Paints", "Berger"], thr: 8, alias: ["brush"] }),
  F("Paint Roller", "पेंट रोलर", "pcs", [60, 320], [['4"', '7"', '9"']], { brands: ["Asian Paints", "Berger"], alias: ["roller"] }),
  F("Wall Emulsion", "दीवार का पेंट (वॉल इमल्शन)", "tin", [350, 6800], [["1L", "4L", "10L", "20L"], col("Brilliant White", "Ivory", "Sky Blue", "Peach", "Lemon Yellow", "Light Green", "Grey", "Pink")], { brands: ["Asian Paints", "Berger", "Nerolac"], thr: 3, alias: ["paint", "rang"] }),
  F("Enamel Paint", "इनेमल पेंट", "tin", [90, 1900], [["100ml", "200ml", "500ml", "1L", "4L"], col("Black", "Red", "Blue", "Green", "Yellow", "White", "Brown", "Silver")], { brands: ["Asian Paints", "Berger"], thr: 4, alias: ["paint", "rang"] }),
  F("Wall Putty", "वॉल पुट्टी", "bag", [60, 1050], [["1kg", "5kg", "20kg", "40kg"]], { brands: ["Birla White", "JK Wall Putty", "Asian Paints"], thr: 5, alias: ["putty"] }),
  F("Primer", "प्राइमर", "tin", [180, 3200], [["1L", "4L", "10L", "20L"], [["Wall", "दीवार"], ["Wood", "लकड़ी"], ["Metal", "धातु"]]], { thr: 3, alias: ["primer"] }),
  F("Thinner", "थिनर", "bottle", [40, 520], [["100ml", "500ml", "1L", "5L"]], { thr: 6, alias: ["thinner"] }),
  F("PVC Pipe", "पीवीसी पाइप", "length", [90, 1700], [['0.5"', '0.75"', '1"', '1.25"', '1.5"', '2"', '3"', '4"'], ["Class 2 Kg", "Class 4 Kg", "Class 6 Kg"]], { brands: ["Supreme", "Finolex", "Astral"], thr: 5, alias: ["pipe", "paip"] }),
  F("PVC Elbow", "पीवीसी एल्बो", "pcs", [8, 190], [['0.5"', '0.75"', '1"', '1.25"', '1.5"', '2"', '3"', '4"']], { brands: ["Supreme", "Astral"], thr: 15, alias: ["pipe fitting", "elbow"] }),
  F("PVC Tee", "पीवीसी टी", "pcs", [10, 230], [['0.5"', '0.75"', '1"', '1.25"', '1.5"', '2"', '3"', '4"']], { brands: ["Supreme", "Astral"], thr: 15, alias: ["pipe fitting", "tee"] }),
  F("PVC Coupler", "पीवीसी कप्लर", "pcs", [6, 150], [['0.5"', '0.75"', '1"', '1.25"', '1.5"', '2"', '3"', '4"']], { brands: ["Supreme", "Astral"], thr: 15, alias: ["pipe fitting", "coupler"] }),
  F("Bib Cock", "नल (बिब कॉक)", "pcs", [90, 1100], [col("Silver", "Brown", "White")], { brands: ["Jaquar", "Cera", "Parryware"], alias: ["tap", "nal"] }),
  F("Shower Head", "शावर", "pcs", [120, 2400], [['4"', '6"', '8"'], col("Silver", "White", "Black")], { brands: ["Jaquar", "Cera"], alias: ["shower"] }),
  F("Synthetic Resin Adhesive", "फेविकोल (गोंद)", "pack", [15, 700], [["50g", "100g", "200g", "500g", "1kg", "5kg"]], { brands: ["Fevicol SH", "Fevicol MR"], thr: 8, alias: ["glue", "gond", "fevicol"] }),
  F("M-Seal Epoxy Putty", "एम-सील", "pack", [25, 160], [["25g", "50g", "100g", "200g"]], { brands: ["Pidilite"], thr: 8, alias: ["mseal", "m-seal"] }),
  F("Cutting Disc", "कटिंग डिस्क", "pcs", [20, 110], [['4"', '5"', '7"'], ["1.0mm", "2.5mm"]], { brands: ["Bosch", "Cumi"], thr: 10, alias: ["disc"] }),
  F("Safety Helmet", "सेफ्टी हेलमेट", "pcs", [120, 380], [col("Yellow", "White", "Red")], { brands: ["Karam", "Udyogi"], alias: ["helmet"] }),
  F("Safety Gloves", "सेफ्टी दस्ताने", "pair", [25, 220], [["Cotton", "Rubber", "Leather", "Cut-resistant"]], { brands: ["Karam", "Udyogi"], thr: 10, alias: ["gloves", "dastane"] }),
  F("Safety Goggles", "सेफ्टी चश्मा", "pcs", [40, 260], [["Clear", "Tinted", "Anti-fog"]], { brands: ["Karam", "Udyogi"], alias: ["goggles"] }),
];

const electrical = [
  F("LED Bulb", "एलईडी बल्ब", "pcs", [40, 220], [["3W", "5W", "7W", "9W", "12W", "15W", "18W", "22W"], [["Cool Day White", "सफेद रोशनी"], ["Warm White", "पीली रोशनी"]]], { brands: ["Philips", "Havells", "Syska", "Wipro", "Crompton"], thr: 15, alias: ["bulb", "led", "bijli"] }),
  F("LED Tube Light", "एलईडी ट्यूबलाइट", "pcs", [150, 520], [["10W", "20W", "22W", "36W"]], { brands: ["Philips", "Havells", "Syska", "Wipro"], thr: 8, alias: ["tubelight", "tube"] }),
  F("LED Batten", "एलईडी बैटन", "pcs", [180, 600], [["10W", "20W", "30W"]], { brands: ["Philips", "Havells", "Syska"], thr: 6, alias: ["batten", "tubelight"] }),
  F("Ceiling Fan", "सीलिंग पंखा", "pcs", [1500, 4200], [["900mm", "1050mm", "1200mm", "1400mm"], col("White", "Brown", "Ivory")], { brands: ["Havells", "Crompton", "Usha", "Orient", "Bajaj"], thr: 3, alias: ["fan", "pankha"] }),
  F("Table Fan", "टेबल पंखा", "pcs", [900, 2600], [["300mm", "400mm", "450mm"]], { brands: ["Havells", "Crompton", "Usha", "Orient"], thr: 3, alias: ["fan", "pankha"] }),
  F("Wall Fan", "दीवार पंखा", "pcs", [1400, 3200], [["400mm", "450mm"], col("White", "Black")], { brands: ["Havells", "Crompton", "Usha"], thr: 3, alias: ["fan", "pankha"] }),
  F("Exhaust Fan", "एग्ज़ॉस्ट पंखा", "pcs", [600, 2400], [["150mm", "230mm", "300mm"]], { brands: ["Havells", "Crompton", "Usha"], thr: 3, alias: ["fan", "pankha"] }),
  F("Modular Switch", "स्विच", "pcs", [25, 160], [["6A 1-way", "6A 2-way", "16A 1-way", "20A Bell Push", "Fan Regulator Knob"]], { brands: ["Anchor Roma", "Havells", "Legrand", "GM"], thr: 15, alias: ["switch", "button"] }),
  F("Modular Socket", "सॉकेट", "pcs", [40, 260], [["6A 2-pin", "6A 3-pin", "16A 3-pin", "5-pin 6A", "TV Socket"]], { brands: ["Anchor Roma", "Havells", "Legrand", "GM"], thr: 12, alias: ["socket", "plug point"] }),
  F("MCB", "एमसीबी", "pcs", [150, 1200], [["6A", "10A", "16A", "20A", "25A", "32A", "40A", "63A"], ["SP", "DP", "TP"]], { brands: ["Havells", "Legrand", "Schneider", "Polycab"], thr: 4, alias: ["mcb", "breaker"] }),
  F("House Wire (Copper)", "कॉपर तार", "coil", [650, 14500], [["1 sqmm", "1.5 sqmm", "2.5 sqmm", "4 sqmm", "6 sqmm", "10 sqmm"], col("Red", "Black", "Yellow", "Green", "Blue")], { brands: ["Polycab", "Havells", "Finolex", "RR Kabel"], thr: 3, alias: ["wire", "tar", "cable"] }),
  F("Extension Board", "एक्सटेंशन बोर्ड", "pcs", [180, 900], [["4 Socket", "6 Socket", "8 Socket", "6 Socket + Surge"]], { brands: ["Anchor", "Havells", "Goldmedal"], thr: 5, alias: ["extension", "board"] }),
  F("Plug Top", "प्लग", "pcs", [15, 120], [["6A 2-pin", "6A 3-pin", "16A 3-pin", "Multi-plug"]], { brands: ["Anchor", "Havells"], thr: 15, alias: ["plug"] }),
  F("Batten Holder", "बैटन होल्डर", "pcs", [10, 90], [["B22 Straight", "B22 Angle", "E27 Screw", "Pendant"]], { brands: ["Anchor", "Havells"], thr: 15, alias: ["holder"] }),
  F("Insulation Tape", "इंसुलेशन टेप", "roll", [10, 80], [col("Black", "Red", "Blue", "Green", "Yellow", "White")], { brands: ["Steelgrip", "3M"], thr: 20, alias: ["tape"] }),
  F("Conduit Pipe", "कंड्यूट पाइप", "length", [25, 140], [["20mm", "25mm", "32mm", "40mm"], ["Light", "Medium", "Heavy"]], { brands: ["Precision", "Supreme"], thr: 10, alias: ["pipe", "conduit"] }),
  F("Junction Box", "जंक्शन बॉक्स", "pcs", [20, 160], [["4x4", "6x6", "8x8", "Round 3\"", "Round 4\""]], { thr: 10, alias: ["box"] }),
  F("Cable Tie", "केबल टाई", "pack", [20, 160], [["100mm", "150mm", "200mm", "300mm"]], { brands: ["Steelgrip", "Addtool"], thr: 15, alias: ["tie"] }),
  F("LED Torch", "टॉर्च", "pcs", [60, 650], [["Pocket", "Rechargeable", "Head Lamp", "Search Light"]], { brands: ["Eveready", "Philips", "Syska"], thr: 6, alias: ["torch", "flashlight"] }),
  F("Dry Cell Battery", "बैटरी सेल", "pack", [10, 180], [["AA", "AAA", "9V", "C", "D", "CR2032"]], { brands: ["Duracell", "Eveready", "Panasonic"], thr: 20, alias: ["battery", "cell", "baitri"] }),
  F("Doorbell", "डोरबेल (घंटी)", "pcs", [90, 950], [["Wired", "Wireless", "Musical", "Bird Sound"]], { brands: ["Anchor", "Havells", "Philips"], thr: 5, alias: ["doorbell", "ghanti"] }),
  F("Fan Regulator", "पंखा रेगुलेटर", "pcs", [80, 520], [["Step 5", "Electronic", "Modular", "Knob"]], { brands: ["Havells", "Anchor", "Crompton"], thr: 8, alias: ["regulator", "fan"] }),
  F("Fuse Wire", "फ्यूज़ तार", "reel", [10, 60], [["5A", "10A", "15A", "30A"]], { thr: 10, alias: ["fuse"] }),
];

const BR_NB = ["Classmate", "Navneet", "Camlin", "Paperkraft"];
const stationery = [
  F("Notebook", "कॉपी", "pcs", [20, 160], [[["Single Line", "सिंगल लाइन"], ["Double Line", "डबल लाइन"], ["Four Line", "फोर लाइन"], ["Square", "चौकोर"], ["Plain", "सादी"], ["Drawing", "ड्रॉइंग"]], ["80 pages", "120 pages", "172 pages", "200 pages"], [["Long", "लंबी"], ["Small", "छोटी"]]], { brands: BR_NB, thr: 20, alias: ["copy", "notebook", "kapi"] }),
  F("Ball Pen", "बॉल पेन", "pcs", [5, 30], [col("Blue", "Black", "Red"), ["0.5mm", "0.7mm", "1.0mm"]], { brands: ["Reynolds", "Cello", "Linc", "Montex", "Flair"], thr: 40, alias: ["pen", "kalam"] }),
  F("Gel Pen", "जेल पेन", "pcs", [10, 60], [col("Blue", "Black"), ["0.5mm", "0.7mm"]], { brands: ["Pilot", "Cello", "Linc", "Uniball"], thr: 30, alias: ["pen", "gel"] }),
  F("Pencil", "पेंसिल", "pcs", [3, 15], [["HB", "2B", "2H"]], { brands: ["Apsara", "Natraj", "Doms", "Camlin"], thr: 50, alias: ["pencil", "pensil"] }),
  F("Eraser", "रबर", "pcs", [3, 25], [["Small", "Medium", "Large", "Dust-free"]], { brands: ["Apsara", "Natraj"], thr: 30, alias: ["rubber", "eraser"] }),
  F("Sharpener", "शार्पनर", "pcs", [3, 40], [["Plastic", "Metal", "Dual Hole", "Desk"]], { brands: ["Apsara", "Camlin"], thr: 30, alias: ["sharpener"] }),
  F("Geometry Box", "ज्यामिति बॉक्स", "set", [60, 280], [["Standard", "Deluxe", "Metal", "Junior"]], { brands: ["Camlin", "Natraj"], thr: 8, alias: ["geometry", "box"] }),
  F("Ruler", "फुटा (स्केल)", "pcs", [5, 60], [["15cm", "30cm", "45cm"], [["Plastic", "प्लास्टिक"], ["Steel", "स्टील"]]], { thr: 20, alias: ["scale", "footta", "ruler"] }),
  F("Compass", "कम्पास", "pcs", [20, 140], [["Student", "Precision", "Metal"]], { brands: ["Camlin", "Natraj"], thr: 10, alias: ["compass"] }),
  F("Permanent Marker", "मार्कर", "pcs", [10, 60], [col("Black", "Blue", "Red", "Green", "Orange", "Purple")], { brands: ["Camlin", "Luxor", "Pilot"], thr: 20, alias: ["marker"] }),
  F("Highlighter", "हाइलाइटर", "pcs", [15, 60], [col("Yellow", "Green", "Pink", "Orange", "Blue")], { brands: ["Camlin", "Luxor", "Stabilo"], thr: 15, alias: ["highlighter"] }),
  F("Sketch Pens", "स्केच पेन", "set", [40, 280], [["12 shades", "24 shades", "36 shades"]], { brands: ["Camlin", "Luxor", "Faber-Castell"], thr: 10, alias: ["sketch", "pen"] }),
  F("Wax Crayons", "क्रेयॉन", "set", [30, 200], [["12 shades", "24 shades", "48 shades"]], { brands: ["Camlin", "Natraj", "Doms"], thr: 10, alias: ["crayon"] }),
  F("Colour Pencils", "रंगीन पेंसिल", "set", [40, 320], [["12 shades", "24 shades", "36 shades"]], { brands: ["Camlin", "Natraj", "Faber-Castell"], thr: 10, alias: ["pencil", "colour"] }),
  F("Water Colour Set", "वॉटर कलर", "set", [50, 260], [["12 cakes", "18 cakes", "24 cakes"]], { brands: ["Camlin", "Doms"], thr: 8, alias: ["colour", "paint"] }),
  F("Glue Stick", "गोंद स्टिक", "pcs", [10, 70], [["8g", "15g", "21g", "36g"]], { brands: ["Camlin", "Fevistik"], thr: 20, alias: ["glue", "gond"] }),
  F("White Glue (Fevicol MR)", "फेविकोल", "bottle", [10, 120], [["15g", "30g", "50g", "100g"]], { brands: ["Fevicol"], thr: 15, alias: ["glue", "gond", "fevicol"] }),
  F("Stapler", "स्टेपलर", "pcs", [40, 380], [["No.10", "24/6 Small", "24/6 Heavy"]], { brands: ["Kangaro", "Maxx"], thr: 8, alias: ["stapler"] }),
  F("Staple Pins", "स्टेपल पिन", "box", [10, 60], [["No.10", "24/6", "23/8"]], { brands: ["Kangaro", "Maxx"], thr: 20, alias: ["staple", "pin"] }),
  F("Paper Clips", "पेपर क्लिप", "box", [10, 70], [["Small", "Medium", "Large", "Coloured"]], { brands: ["Kangaro", "Maxx"], thr: 20, alias: ["clip"] }),
  F("Binder Clips", "बाइंडर क्लिप", "box", [15, 110], [["15mm", "19mm", "25mm", "32mm", "41mm", "51mm"]], { brands: ["Kangaro", "Maxx"], thr: 15, alias: ["clip"] }),
  F("File Folder", "फाइल", "pcs", [10, 120], [["Plastic Button", "Box File", "Spring File", "Ring Binder", "Transparent"], ["A4", "FC"]], { brands: ["Solo", "Kangaro", "Navneet"], thr: 20, alias: ["file", "folder"] }),
  F("Envelope", "लिफाफा", "pack", [20, 160], [["Small", "Medium", "Large", "A4", "Legal"]], { brands: ["Navneet", "Paperkraft"], thr: 15, alias: ["envelope", "lifafa"] }),
  F("A4 Copier Paper", "A4 कागज़", "ream", [220, 520], [["70 GSM", "75 GSM", "80 GSM"]], { brands: ["JK Copier", "Navigator", "Double A"], thr: 10, alias: ["paper", "a4", "kagaz"] }),
  F("Sticky Notes", "स्टिकी नोट्स", "pack", [20, 160], [["3x3", "3x2", "4x3", "Neon Flags"]], { brands: ["Post-it", "Camlin"], thr: 15, alias: ["sticky", "notes"] }),
  F("Chart Paper", "चार्ट पेपर", "sheet", [5, 20], [col("White", "Yellow", "Green", "Blue", "Pink", "Orange", "Red", "Brown")], { thr: 30, alias: ["chart", "paper"] }),
  F("Register", "रजिस्टर", "pcs", [50, 380], [["100 pages", "200 pages", "300 pages", "400 pages"], [["Ruled", "रूल्ड"], ["Unruled", "सादा"]]], { brands: ["Navneet", "Classmate", "Paperkraft"], thr: 10, alias: ["register"] }),
  F("Diary", "डायरी", "pcs", [60, 450], [["Pocket", "A5", "A4", "Executive"]], { brands: ["Navneet", "Paperkraft"], thr: 8, alias: ["diary"] }),
  F("Calculator", "कैलकुलेटर", "pcs", [150, 1400], [["8 digit", "10 digit", "12 digit", "Scientific"]], { brands: ["Casio", "Citizen"], thr: 4, alias: ["calculator"] }),
  F("Cello Tape", "टेप", "roll", [8, 120], [["12mm", "24mm", "48mm"]], { brands: ["Camlin", "Apsara", "3M"], thr: 20, alias: ["tape", "cello"] }),
  F("Whitener", "व्हाइटनर", "pcs", [15, 60], [["Pen", "Bottle", "Tape"]], { brands: ["Camlin", "Kores"], thr: 15, alias: ["whitener", "correction"] }),
  F("Rubber Bands", "रबर बैंड", "pack", [10, 80], [["Small", "Medium", "Large"]], { thr: 15, alias: ["rubber", "band"] }),
  F("Paper Punch", "पंच मशीन", "pcs", [50, 380], [["2 Hole Small", "2 Hole Heavy", "Adjustable"]], { brands: ["Kangaro", "Maxx"], thr: 5, alias: ["punch"] }),
  F("Clipboard", "क्लिपबोर्ड", "pcs", [40, 220], [["A4 Plastic", "A4 Wooden", "FC Wooden"]], { thr: 8, alias: ["clipboard", "pad"] }),
];

const PHONES = ["Samsung Galaxy M14", "Samsung Galaxy A15", "Redmi 12", "Redmi Note 13", "Realme Narzo 60", "Realme C55", "Oppo A58", "Vivo Y27", "Vivo T2x", "OnePlus Nord CE3", "iPhone 13", "iPhone 14", "Poco M6", "Moto G54"];
const BR_PH = ["Mi", "Samsung", "Realme", "Oppo", "boAt", "Ambrane"];
const electronics = [
  F("Mobile Charger", "मोबाइल चार्जर", "pcs", [199, 2200], [["Type-C", "Micro-USB", "Lightning"], ["10W", "18W", "20W", "33W", "45W", "65W"]], { brands: BR_PH, thr: 5, alias: ["charger", "adapter"] }),
  F("USB Cable", "यूएसबी केबल", "pcs", [49, 650], [["Type-C", "Micro-USB", "Lightning"], ["0.5m", "1m", "1.5m", "2m"]], { brands: ["boAt", "Ambrane", "Portronics", "Mi", "Belkin"], thr: 10, alias: ["cable", "wire", "usb"] }),
  F("Wired Earphones", "ईयरफोन", "pcs", [99, 1200], [col("Black", "White")], { brands: ["boAt", "JBL", "Realme", "Noise", "Sony"], thr: 6, alias: ["earphone", "earphones", "handsfree"] }),
  F("Wireless Neckband", "वायरलेस नेकबैंड", "pcs", [699, 2400], [col("Black", "Blue")], { brands: ["boAt", "JBL", "Realme", "Noise", "Sony"], thr: 4, alias: ["neckband", "earphone", "bluetooth"] }),
  F("TWS Earbuds", "वायरलेस ईयरबड्स", "pcs", [799, 4200], [col("Black", "White")], { brands: ["boAt", "JBL", "Realme", "Noise", "Sony"], thr: 4, alias: ["earbuds", "airdopes", "bluetooth"] }),
  F("Headphones", "हेडफोन", "pcs", [599, 5500], [["Wired", "Bluetooth"]], { brands: ["boAt", "JBL", "Sony", "Zebronics"], thr: 3, alias: ["headphone", "headset"] }),
  F("Power Bank", "पावर बैंक", "pcs", [599, 3200], [["5000mAh", "10000mAh", "15000mAh", "20000mAh", "30000mAh"]], { brands: ["Mi", "Ambrane", "Realme", "Syska", "Portronics"], thr: 3, alias: ["powerbank", "charger"] }),
  F("Screen Guard", "स्क्रीन गार्ड", "pcs", [49, 399], [PHONES, [["Tempered", "टफ़्ड ग्लास"], ["Matte", "मैट"]]], { thr: 10, alias: ["guard", "tempered", "glass"] }),
  F("Back Cover", "बैक कवर", "pcs", [49, 599], [PHONES, [["Silicone", "सिलिकॉन"], ["Transparent", "पारदर्शी"], ["Hard Matte", "हार्ड मैट"]]], { thr: 8, alias: ["cover", "case"] }),
  F("Memory Card", "मेमोरी कार्ड", "pcs", [250, 1900], [["16GB", "32GB", "64GB", "128GB", "256GB"]], { brands: ["SanDisk", "Samsung"], thr: 5, alias: ["memory", "sd card"] }),
  F("Pen Drive", "पेन ड्राइव", "pcs", [299, 1400], [["16GB", "32GB", "64GB", "128GB", "256GB"]], { brands: ["SanDisk", "HP", "Kingston"], thr: 5, alias: ["pendrive", "usb drive"] }),
  F("Computer Mouse", "माउस", "pcs", [199, 1600], [["Wired", "Wireless", "Bluetooth", "Gaming"]], { brands: ["Logitech", "HP", "Zebronics"], thr: 4, alias: ["mouse"] }),
  F("Keyboard", "कीबोर्ड", "pcs", [299, 2400], [["Wired", "Wireless", "Combo"]], { brands: ["Logitech", "HP", "Zebronics"], thr: 3, alias: ["keyboard"] }),
  F("HDMI Cable", "एचडीएमआई केबल", "pcs", [149, 899], [["1.5m", "3m", "5m", "10m"]], { brands: ["Belkin", "Zebronics"], thr: 4, alias: ["hdmi", "cable"] }),
  F("Aux Cable", "ऑक्स केबल", "pcs", [49, 299], [["1m", "1.5m", "3m"]], { brands: ["boAt", "Zebronics"], thr: 6, alias: ["aux", "cable"] }),
  F("Bluetooth Speaker", "ब्लूटूथ स्पीकर", "pcs", [699, 6500], [["Mini", "Portable", "Party"]], { brands: ["boAt", "JBL", "Zebronics", "Sony"], thr: 3, alias: ["speaker", "bluetooth"] }),
  F("OTG Adapter", "ओटीजी अडैप्टर", "pcs", [49, 299], [["Type-C", "Micro-USB", "Lightning"]], { brands: ["Ambrane", "Portronics"], thr: 6, alias: ["otg"] }),
  F("Car Mobile Holder", "कार मोबाइल होल्डर", "pcs", [149, 899], [["Dashboard", "Vent Clip", "Magnetic"]], { brands: ["Ambrane", "Portronics"], thr: 4, alias: ["holder", "car"] }),
  F("Ring Light", "रिंग लाइट", "pcs", [399, 2500], [['6"', '10"', '12"']], { brands: ["Digitek", "Zebronics"], thr: 3, alias: ["ringlight", "light"] }),
];

const pharmacy = [   // restricted category: stocked for inventory, NEVER published (D-04)
  F("Paracetamol 500mg Tablets", "पैरासिटामोल 500mg", "strip", [15, 30], [["Strip of 10", "Strip of 15"]], { thr: 10 }),
  F("Cetirizine 10mg Tablets", "सेटिरिज़िन 10mg", "strip", [20, 45], [["Strip of 10"]], { thr: 10 }),
  F("ORS Powder Sachet", "ओआरएस पाउडर", "sachet", [18, 40], [["21g", "4.9g"]], { thr: 20 }),
  F("Antiseptic Liquid", "एंटीसेप्टिक लिक्विड", "bottle", [45, 180], [["100ml", "250ml", "500ml"]], { thr: 8 }),
  F("Crepe Bandage", "क्रेप बैंडेज", "pcs", [30, 90], [["6cm", "10cm", "15cm"]], { thr: 8 }),
  F("Digital Thermometer", "डिजिटल थर्मामीटर", "pcs", [120, 400], [["Standard", "Flexible Tip"]], { thr: 4 }),
];

export const FAMILIES = { hardware, electrical, stationery, "electronics-accessories": electronics, pharmacy };

/** Expand every family into concrete product templates (deterministic order). */
export function buildPool(category) {
  const out = [];
  for (const f of FAMILIES[category]) {
    const dims = f.dims.filter((d) => d.length && !(d.length === 1 && d[0] === ""));
    const brands = f.brands.length ? [f.brands] : [[""]];
    const all = [brands[0], ...dims];
    const total = all.reduce((n, d) => n * d.length, 1);
    for (let k = 0; k < total; k++) {
      let rest = k; const pick = [];
      for (let i = all.length - 1; i >= 0; i--) { pick[i] = all[i][rest % all[i].length]; rest = Math.floor(rest / all[i].length); }
      const brand = pick[0], vs = pick.slice(1).map((v) => (Array.isArray(v) ? v : [v, v]));
      const idx0 = dims.length ? dims[0].indexOf(dims[0].find((x) => (Array.isArray(x) ? x[0] : x) === vs[0][0])) : 0;
      const frac = dims.length && dims[0].length > 1 ? idx0 / (dims[0].length - 1) : 0.5;
      const bf = brand ? 0.9 + ((brand.length * 7) % 25) / 100 : 1;                      // brand price factor 0.90-1.14
      let price = (f.price[0] + (f.price[1] - f.price[0]) * frac) * bf;
      price = price > 200 ? Math.round(price / 5) * 5 : Math.max(1, Math.round(price));
      out.push({ category, family: f.en, unit: f.unit, frac: f.frac, thr: f.thr, alias: f.alias, brand: brand || null, price,
        name: [brand, f.en, ...vs.map((v) => v[0])].filter(Boolean).join(" "),
        name_hi: [brand, f.hi, ...vs.map((v) => v[1])].filter(Boolean).join(" ") });
    }
  }
  return out;
}

// Extra synonym groups (equivalent English / Hinglish / Hindi single words) layered on top of migration 0004's.
export const SYNONYMS = [
  ["screwdriver", "pechkas", "pecha", "पेचकस"], ["spanner", "wrench", "pana", "पाना"], ["pliers", "plier", "plas", "प्लास"],
  ["saw", "hacksaw", "aari", "आरी"], ["nail", "keel", "कील"], ["lock", "padlock", "tala", "ताला"], ["paint", "rang", "पेंट", "रंग"],
  ["brush", "ब्रश"], ["pipe", "paip", "पाइप"], ["tap", "nal", "bibcock", "नल"], ["switch", "स्विच"], ["socket", "सॉकेट"],
  ["battery", "cell", "baitri", "बैटरी", "सेल"], ["torch", "flashlight", "टॉर्च"], ["earphone", "earphones", "handsfree", "ईयरफोन"],
  ["tubelight", "tube", "ट्यूबलाइट"], ["pencil", "pensil", "पेंसिल"], ["eraser", "rubber", "रबर"], ["register", "रजिस्टर"],
  ["file", "folder", "फाइल"], ["stapler", "स्टेपलर"], ["glue", "gond", "fevicol", "गोंद", "फेविकोल"], ["ruler", "footta", "scale", "फुटा"],
  ["cover", "case", "कवर"], ["guard", "tempered", "स्क्रीन"], ["powerbank", "पावर"], ["mouse", "माउस"], ["keyboard", "कीबोर्ड"],
  ["speaker", "स्पीकर"], ["helmet", "हेलमेट"], ["gloves", "dastane", "दस्ताने"], ["bolt", "बोल्ट"], ["nut", "नट"], ["hinge", "kabza", "कब्ज़ा"],
  ["putty", "पुट्टी"], ["primer", "प्राइमर"], ["thinner", "थिनर"], ["chisel", "chheni", "छेनी"], ["drill", "ड्रिल"], ["envelope", "lifafa", "लिफाफा"],
  ["calculator", "कैलकुलेटर"], ["diary", "डायरी"], ["marker", "मार्कर"], ["compass", "कम्पास"], ["sharpener", "शार्पनर"],
];
