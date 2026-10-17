import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import SVGtoPDF from "svg-to-pdfkit";
import { arucoToSVGString } from "aruco-marker";

const outPath = path.resolve(process.cwd(), "client/public/target.pdf");
const doc = new PDFDocument({ size: "A4", margin: 24 });
doc.pipe(fs.createWriteStream(outPath));

const markerIds = [10, 11, 12, 13, 20];
const markerSvgs = markerIds.map((id) => ({
  id,
  svg: arucoToSVGString(id, "140px"),
}));

doc.fontSize(18).text("RealityCheck Tracking Target", { align: "center" });
doc.fontSize(11).text("Print at 100% scale. Use IDs 10,11,12,13 corners and 20 as reference.", {
  align: "center",
});

const positions: Record<number, { x: number; y: number }> = {
  10: { x: 32, y: 90 },
  11: { x: 412, y: 90 },
  12: { x: 412, y: 610 },
  13: { x: 32, y: 610 },
  20: { x: 222, y: 350 },
};

for (const marker of markerSvgs) {
  const pos = positions[marker.id];
  SVGtoPDF(doc, marker.svg, pos.x, pos.y);
  doc.fontSize(12).text(String(marker.id), pos.x + 52, pos.y + 122, { width: 30, align: "center" });
}

doc.rect(20, 78, 555, 675).lineWidth(1).stroke("#334155");
doc.end();
