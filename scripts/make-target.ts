import fs from "node:fs";
import path from "node:path";
import jsAruco from "js-aruco2";
import PDFDocument from "pdfkit";
import {
  ARUCO_DICTIONARY,
  BOARD,
  MARKERS,
  SCALE_BAR,
  TEST_DOT,
  VERIFY_ZONE,
} from "../shared/src/target-layout.ts";

const PT_PER_MM = 72 / 25.4;
const PAGE_MM = { width: 215.9, height: 279.4 };
const OFFSET_MM = {
  x: (PAGE_MM.width - BOARD.width) / 2,
  y: (PAGE_MM.height - BOARD.height) / 2,
};

const pt = (mm: number) => mm * PT_PER_MM;
const px = (mm: number) => pt(OFFSET_MM.x + mm);
const py = (mm: number) => pt(OFFSET_MM.y + mm);

const dictionary = new jsAruco.AR.Dictionary(ARUCO_DICTIONARY);
const outPath = path.resolve(process.cwd(), "client/public/target.pdf");
const doc = new PDFDocument({ size: "LETTER", margin: 0 });
doc.pipe(fs.createWriteStream(outPath));

doc.rect(px(0), py(0), pt(BOARD.width), pt(BOARD.height)).lineWidth(0.5).stroke("#bbbbbb");

for (const marker of MARKERS) {
  const bits: string = dictionary.codeList[marker.id];
  const bitCount = Math.sqrt(bits.length);
  const cell = marker.size / (bitCount + 2);
  doc.rect(px(marker.x), py(marker.y), pt(marker.size), pt(marker.size)).fill("#000000");
  for (let row = 0; row < bitCount; row += 1) {
    for (let col = 0; col < bitCount; col += 1) {
      if (bits[row * bitCount + col] === "1") {
        doc
          .rect(px(marker.x + (col + 1) * cell), py(marker.y + (row + 1) * cell), pt(cell), pt(cell))
          .fill("#ffffff");
      }
    }
  }
  const label = marker.role === "reference" ? `ref ${marker.id}` : `${marker.id}`;
  doc
    .fillColor("#666666")
    .fontSize(7)
    .text(label, px(marker.x), py(marker.y + marker.size + 1), { width: pt(marker.size), align: "center" });
}

doc
  .fillColor("#111111")
  .fontSize(14)
  .text("RealityCheck target", px(0), py(52), { width: pt(BOARD.width), align: "center" });
doc
  .fillColor("#444444")
  .fontSize(9)
  .text("Print at 100% / actual size. Keep the sheet flat and well lit.", px(0), py(60), {
    width: pt(BOARD.width),
    align: "center",
  });

const dot = { x: px(TEST_DOT.x), y: py(TEST_DOT.y) };
doc.circle(dot.x, dot.y, pt(2)).fill("#e11d48");
doc
  .moveTo(dot.x - pt(8), dot.y)
  .lineTo(dot.x + pt(8), dot.y)
  .moveTo(dot.x, dot.y - pt(8))
  .lineTo(dot.x, dot.y + pt(8))
  .lineWidth(0.6)
  .stroke("#e11d48");
doc
  .fillColor("#e11d48")
  .fontSize(7)
  .text("test dot", dot.x + pt(3), dot.y + pt(3));

const barY = py(SCALE_BAR.y);
doc
  .moveTo(px(SCALE_BAR.x), barY)
  .lineTo(px(SCALE_BAR.x + SCALE_BAR.length), barY)
  .lineWidth(1)
  .stroke("#111111");
for (let mm = 0; mm <= SCALE_BAR.length; mm += 10) {
  const tick = mm % 50 === 0 ? 3 : 1.5;
  doc
    .moveTo(px(SCALE_BAR.x + mm), barY - pt(tick))
    .lineTo(px(SCALE_BAR.x + mm), barY)
    .stroke("#111111");
}
doc
  .fillColor("#444444")
  .fontSize(7)
  .text("this bar should measure 100 mm", px(SCALE_BAR.x), barY + pt(1.5), {
    width: pt(SCALE_BAR.length),
    align: "center",
  });

doc
  .rect(px(VERIFY_ZONE.x), py(VERIFY_ZONE.y), pt(VERIFY_ZONE.width), pt(VERIFY_ZONE.height))
  .dash(4, { space: 3 })
  .lineWidth(0.8)
  .stroke("#888888")
  .undash();
doc
  .fillColor("#888888")
  .fontSize(8)
  .text("PLACE PART HERE", px(VERIFY_ZONE.x), py(VERIFY_ZONE.y + VERIFY_ZONE.height / 2 - 2), {
    width: pt(VERIFY_ZONE.width),
    align: "center",
  });

doc.end();
console.log(`Wrote ${outPath}`);
