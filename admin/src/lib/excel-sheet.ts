// The Excel reports' look (exceljs): a green title line, then a green header.
// Used by the loan reports (api/admin/loan-reports) and the Claude questions
// download (api/admin/claude-questions).

import type ExcelJS from "exceljs";

export const GREEN = "FF178A5C";

// A title line, then a two-row header: single columns span both rows, a pair
// ("1st disbursement" → Date | Amount) spans two columns.
export type SheetCol = { label: string; width: number; pair?: [string, string] };
export function sheetHeader(ws: ExcelJS.Worksheet, title: string, cols: SheetCol[]): number {
  const total = cols.reduce((n, c) => n + (c.pair ? 2 : 1), 0);
  ws.addRow([title]).font = { bold: true, size: 14, color: { argb: GREEN } };
  ws.mergeCells(1, 1, 1, total);
  ws.addRow([]);
  const r1 = ws.getRow(3), r2 = ws.getRow(4);
  let c = 1;
  for (const col of cols) {
    if (col.pair) {
      r1.getCell(c).value = col.label;
      ws.mergeCells(3, c, 3, c + 1);
      r2.getCell(c).value = col.pair[0];
      r2.getCell(c + 1).value = col.pair[1];
      ws.getColumn(c).width = 13;
      ws.getColumn(c + 1).width = col.width;
      c += 2;
    } else {
      r1.getCell(c).value = col.label;
      ws.mergeCells(3, c, 4, c);
      ws.getColumn(c).width = col.width;
      c += 1;
    }
  }
  for (const r of [r1, r2]) {
    for (let i = 1; i <= total; i++) {
      const cell = r.getCell(i);
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      cell.border = { top: { style: "thin", color: { argb: "FFCDEADD" } }, bottom: { style: "thin", color: { argb: "FFCDEADD" } }, left: { style: "thin", color: { argb: "FFCDEADD" } }, right: { style: "thin", color: { argb: "FFCDEADD" } } };
    }
  }
  ws.views = [{ state: "frozen", ySplit: 4 }];
  return total;
}
