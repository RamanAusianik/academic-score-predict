import { Injectable } from '@angular/core';
import { mergeXlsxBuffers } from './excel-merge';

interface SaveXlsxResult {
  ok: boolean;
  canceled?: boolean;
  filePath?: string;
}

function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error(`Не удалось прочитать файл «${file.name}».`));
    reader.readAsArrayBuffer(file);
  });
}

function ipcRenderer(): { invoke(channel: string, ...args: unknown[]): Promise<unknown> } | null {
  const req = (globalThis as { require?: (id: string) => { ipcRenderer?: { invoke(channel: string, ...args: unknown[]): Promise<unknown> } } }).require;
  if (!req) return null;
  try {
    return req('electron').ipcRenderer ?? null;
  } catch {
    return null;
  }
}

@Injectable({ providedIn: 'root' })
export class ExcelMergeService {
  async mergeAndSave(files: File[], defaultName = 'merged.xlsx'): Promise<{ saved: boolean; filePath?: string }> {
    if (files.length < 2) {
      throw new Error('Выберите минимум два Excel-файла (.xlsx).');
    }

    const buffers = await Promise.all(files.map(readFileAsArrayBuffer));
    const merged = await mergeXlsxBuffers(buffers);
    const bytes = new Uint8Array(merged);

    const ipc = ipcRenderer();
    if (ipc) {
      const result = (await ipc.invoke('save-xlsx-file', Array.from(bytes), defaultName)) as SaveXlsxResult;
      if (result.canceled) return { saved: false };
      if (!result.ok) throw new Error('Не удалось сохранить файл.');
      return { saved: true, filePath: result.filePath };
    }

    // Fallback when not running inside Electron (e.g. ng serve).
    this.downloadBytes(merged, defaultName);
    return { saved: true, filePath: defaultName };
  }

  private downloadBytes(data: ArrayBuffer, filename: string): void {
    const blob = new Blob([data], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}
