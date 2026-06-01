import { Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ExcelMergeService } from '../excel/excel-merge.service';

@Component({
  selector: 'app-excel-merge-page',
  imports: [MatButtonModule, MatCardModule, MatProgressBarModule],
  templateUrl: './excel-merge-page.html',
  styleUrl: './excel-merge-page.sass',
})
export class ExcelMergePage {
  private readonly excelMergeService = inject(ExcelMergeService);

  readonly excelFiles = signal<File[]>([]);
  readonly busy = signal(false);
  readonly status = signal<string>('');
  readonly error = signal<string>('');

  onExcelFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const list = input.files;
    if (!list || list.length === 0) return;
    this.excelFiles.set(Array.from(list));
    this.error.set('');
    this.status.set(`Выбрано файлов: ${list.length}. Порядок объединения — как в списке ниже.`);
    input.value = '';
  }

  clearExcelFiles(): void {
    this.excelFiles.set([]);
    this.status.set('');
    this.error.set('');
  }

  async mergeExcelFiles(): Promise<void> {
    const files = this.excelFiles();
    if (files.length < 2) {
      this.error.set('Выберите минимум два Excel-файла (.xlsx).');
      return;
    }

    this.busy.set(true);
    this.error.set('');
    this.status.set('Объединение файлов...');

    try {
      const defaultName =
        files.length === 2
          ? `${files[0].name.replace(/\.xlsx$/i, '')}_${files[1].name.replace(/\.xlsx$/i, '')}.xlsx`
          : 'merged.xlsx';
      const result = await this.excelMergeService.mergeAndSave(files, defaultName);
      if (result.saved) {
        this.status.set(
          result.filePath
            ? `Файл сохранён: ${result.filePath}`
            : 'Объединённый файл сохранён.'
        );
      } else {
        this.status.set('Сохранение отменено.');
      }
    } catch (e) {
      this.error.set((e as Error).message);
      this.status.set('');
    } finally {
      this.busy.set(false);
    }
  }

  trackExcelFile = (_: number, file: File) => file.name + file.size;
}
