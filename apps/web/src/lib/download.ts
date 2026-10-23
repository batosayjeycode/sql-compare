import { renderReport, REPORT_FILES, type ReportFormat, type ReportInput } from '@sql-compare/core';

const pad = (n: number) => String(n).padStart(2, '0');

/** `sql-compare-report-20261023-1405.md` */
export function reportFileName(format: ReportFormat, date = new Date()): string {
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  return `sql-compare-report-${stamp}.${REPORT_FILES[format].extension}`;
}

/** Render the report and hand it to the browser as a download (nothing leaves the device). */
export function downloadReport(input: ReportInput, format: ReportFormat) {
  const date = input.generatedAt ?? new Date();
  const blob = new Blob([renderReport({ ...input, generatedAt: date }, format)], {
    type: REPORT_FILES[format].mime,
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = reportFileName(format, date);
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
