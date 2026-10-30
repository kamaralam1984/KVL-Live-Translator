import { dialog, BrowserWindow } from 'electron';
import { writeFile } from 'node:fs/promises';
import { logger } from './logger';

export interface FileFilter {
  name: string;
  extensions: string[];
}

/** Native save dialog + write — TXT/Markdown/JSON exports all go through
 * this one function, the desktop-idiomatic choice over a browser-style
 * blob-download-to-Downloads-folder. */
export async function saveTextFile(content: string, suggestedName: string, filters: FileFilter[]): Promise<boolean> {
  const result = await dialog.showSaveDialog({ defaultPath: suggestedName, filters });
  if (result.canceled || !result.filePath) return false;

  await writeFile(result.filePath, content, 'utf-8');
  return true;
}

/** Real PDF generation via Electron's native webContents.printToPDF() on a
 * hidden, throwaway BrowserWindow — no PDF library dependency needed. */
export async function exportSummaryPdf(html: string, suggestedName: string): Promise<boolean> {
  const result = await dialog.showSaveDialog({ defaultPath: suggestedName, filters: [{ name: 'PDF Document', extensions: ['pdf'] }] });
  if (result.canceled || !result.filePath) return false;

  const hiddenWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  try {
    await hiddenWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const pdfBuffer = await hiddenWindow.webContents.printToPDF({});
    await writeFile(result.filePath, pdfBuffer);
    return true;
  } catch (error) {
    logger.error('exportSummaryPdf failed', error);
    throw error;
  } finally {
    hiddenWindow.destroy();
  }
}
