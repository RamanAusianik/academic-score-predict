import {
  Component,
  ElementRef,
  OnDestroy,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import Chart from 'chart.js/auto';
import { analyzeDebtsFromFiles, ExcelDebtStats } from '../excel/excel-analytics';
import { ExcelMergeService } from '../excel/excel-merge.service';

@Component({
  selector: 'app-excel-merge-page',
  imports: [MatButtonModule, MatCardModule, MatProgressBarModule],
  templateUrl: './excel-merge-page.html',
  styleUrl: './excel-merge-page.sass',
})
export class ExcelMergePage implements OnDestroy {
  private readonly excelMergeService = inject(ExcelMergeService);

  readonly excelFiles = signal<File[]>([]);
  readonly busy = signal(false);
  readonly analyzing = signal(false);
  readonly status = signal<string>('');
  readonly error = signal<string>('');
  readonly debtStats = signal<ExcelDebtStats | null>(null);

  readonly groupDebtCanvas = viewChild<ElementRef<HTMLCanvasElement>>('groupDebtCanvas');
  readonly subjectDebtCanvas = viewChild<ElementRef<HTMLCanvasElement>>('subjectDebtCanvas');

  private charts: Chart[] = [];

  constructor() {
    effect(() => {
      const stats = this.debtStats();
      if (!stats) return;
      queueMicrotask(() => requestAnimationFrame(() => this.renderCharts()));
    });
  }

  ngOnDestroy(): void {
    this.destroyCharts();
  }

  onExcelFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const list = input.files;
    if (!list || list.length === 0) return;
    this.excelFiles.set(Array.from(list));
    this.error.set('');
    this.status.set(`Выбрано файлов: ${list.length}. Порядок объединения — как в списке ниже.`);
    input.value = '';
    void this.analyzeSelectedFiles();
  }

  clearExcelFiles(): void {
    this.excelFiles.set([]);
    this.debtStats.set(null);
    this.destroyCharts();
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

  /** Vertical bar chart height scales with item count so every label stays visible. */
  chartHeight(itemCount: number): number {
    const barSize = 30;
    const padding = 56;
    return Math.max(200, itemCount * barSize + padding);
  }

  private async analyzeSelectedFiles(): Promise<void> {
    const files = this.excelFiles();
    if (files.length === 0) {
      this.debtStats.set(null);
      return;
    }

    this.analyzing.set(true);
    this.destroyCharts();
    try {
      const buffers = await Promise.all(files.map((file) => this.readFileAsArrayBuffer(file)));
      const stats = await analyzeDebtsFromFiles(buffers);
      this.debtStats.set(stats);
    } catch (e) {
      this.debtStats.set(null);
      this.error.set((e as Error).message);
    } finally {
      this.analyzing.set(false);
    }
  }

  private readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(new Error(`Не удалось прочитать файл «${file.name}».`));
      reader.readAsArrayBuffer(file);
    });
  }

  private destroyCharts(): void {
    for (const chart of this.charts) chart.destroy();
    this.charts = [];
  }

  private renderCharts(): void {
    const stats = this.debtStats();
    if (!stats) return;
    this.destroyCharts();

    const groupEl = this.groupDebtCanvas()?.nativeElement;
    if (groupEl && stats.byGroup.length > 0) {
      this.charts.push(
        new Chart(groupEl, {
          type: 'bar',
          data: {
            labels: stats.byGroup.map((d) => d.label),
            datasets: [
              {
                label: 'Задолженности',
                data: stats.byGroup.map((d) => d.value),
                backgroundColor: '#e53935',
              },
            ],
          },
          options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { beginAtZero: true, ticks: { precision: 0 } } },
          },
        })
      );
    }

    const subjectEl = this.subjectDebtCanvas()?.nativeElement;
    if (subjectEl && stats.bySubject.length > 0) {
      this.charts.push(
        new Chart(subjectEl, {
          type: 'bar',
          data: {
            labels: stats.bySubject.map((d) => d.label),
            datasets: [
              {
                label: 'Задолженности',
                data: stats.bySubject.map((d) => d.value),
                backgroundColor: '#fb8c00',
              },
            ],
          },
          options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { beginAtZero: true, ticks: { precision: 0 } } },
          },
        })
      );
    }
  }
}
