export type BenchRow = {
  ts: number;
  metric: string;
  value: number;
  note: string;
};

const rows: BenchRow[] = [];

export function addBenchRow(row: Omit<BenchRow, "ts">) {
  rows.push({ ...row, ts: Date.now() });
}

export function getBenchRows() {
  return [...rows];
}

export function clearBenchRows() {
  rows.length = 0;
}

export function downloadBenchCsv() {
  const header = "ts,metric,value,note";
  const body = rows.map((row) => `${row.ts},${row.metric},${row.value},"${row.note.replaceAll('"', "'")}"`);
  const blob = new Blob([[header, ...body].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `realitycheck-bench-${new Date().toISOString().slice(0, 19)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
