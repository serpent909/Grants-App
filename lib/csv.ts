/**
 * Minimal CSV export (browser). No dependency.
 *
 * Cells that begin with = + - @ (or tab/CR) are prefixed with an apostrophe so
 * a spreadsheet never evaluates text scraped from the web as a formula.
 */

type Cell = string | number | null | undefined;

function escapeCell(value: Cell): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: Cell[][]): string {
  return [headers, ...rows].map(row => row.map(escapeCell).join(',')).join('\r\n');
}

/** Build a CSV and trigger a download. The BOM makes Excel read it as UTF-8. */
export function downloadCsv(filename: string, headers: string[], rows: Cell[][]): void {
  const blob = new Blob(['﻿', toCsv(headers, rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** "My search: grants" → "my-search-grants" for use in a filename. */
export function slugForFilename(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'export';
}
