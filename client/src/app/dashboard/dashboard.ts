import { DecimalPipe } from '@angular/common';
import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import Chart from 'chart.js/auto';
import { ModelService } from '../model/model.service';
import { CorrelationPair, RiskLevel, StudentPrediction } from '../model/types';

@Component({
  selector: 'app-dashboard',
  imports: [
    DecimalPipe,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatProgressBarModule,
    MatTooltipModule,
  ],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.sass',
})
export class Dashboard {
  private readonly modelService = inject(ModelService);

  readonly model = this.modelService.model;
  readonly restored = this.modelService.restoredFromStorage;
  readonly prediction = this.modelService.prediction;

  readonly busy = signal(false);
  readonly status = signal<string>('');
  readonly error = signal<string>('');
  readonly trainingFileName = signal<string>('');
  readonly predictionFileName = signal<string>('');

  readonly attendanceCanvas = viewChild<ElementRef<HTMLCanvasElement>>('attendanceCanvas');
  readonly examBySubjectCanvas = viewChild<ElementRef<HTMLCanvasElement>>('examBySubjectCanvas');
  readonly attendanceSubjectCanvas = viewChild<ElementRef<HTMLCanvasElement>>('attendanceSubjectCanvas');
  readonly histogramCanvas = viewChild<ElementRef<HTMLCanvasElement>>('histogramCanvas');
  readonly gradeByAttendanceCanvas = viewChild<ElementRef<HTMLCanvasElement>>('gradeByAttendanceCanvas');
  readonly correlationCanvas = viewChild<ElementRef<HTMLCanvasElement>>('correlationCanvas');

  private charts: Chart[] = [];

  readonly metrics = computed(() => this.model()?.metrics ?? null);
  readonly trends = computed(() => this.model()?.trends ?? null);

  readonly riskCounts = computed(() => {
    const p = this.prediction();
    return p ? { high: p.highRisk, medium: p.mediumRisk, low: p.lowRisk } : null;
  });

  constructor() {
    // (Re)render the trend charts whenever the model or canvases change.
    effect(() => {
      const trends = this.trends();
      const refs = [
        this.attendanceCanvas(),
        this.examBySubjectCanvas(),
        this.attendanceSubjectCanvas(),
        this.histogramCanvas(),
        this.gradeByAttendanceCanvas(),
        this.correlationCanvas(),
      ];
      if (!trends || refs.some((r) => !r)) return;
      // defer so the canvases have their layout size
      queueMicrotask(() => this.renderCharts());
    });
  }

  // ---- file handling ----------------------------------------------------

  onTrainingFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.trainingFileName.set(file.name);
    this.error.set('');
    this.busy.set(true);
    this.status.set('Чтение файла...');

    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      // let the UI paint the progress bar before the heavy work
      setTimeout(() => {
        try {
          this.status.set('Разбор CSV...');
          const rows = this.modelService.parse(text);
          if (rows.length === 0) throw new Error('Файл не содержит строк с данными.');
          this.status.set(`Обучение модели на ${rows.length.toLocaleString('ru-RU')} строках...`);
          const model = this.modelService.trainOn(rows);
          this.status.set(
            `Модель обучена: ${model.metrics.trainRows.toLocaleString('ru-RU')} строк, ` +
              `${model.metrics.students.toLocaleString('ru-RU')} студентов. Сохранена локально.`
          );
        } catch (e) {
          this.error.set((e as Error).message);
          this.status.set('');
        } finally {
          this.busy.set(false);
        }
      }, 30);
    };
    reader.onerror = () => {
      this.error.set('Не удалось прочитать файл.');
      this.busy.set(false);
    };
    reader.readAsText(file, 'utf-8');
    input.value = '';
  }

  onPredictionFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!this.model()) {
      this.error.set('Сначала обучите модель на обучающей выборке.');
      input.value = '';
      return;
    }
    this.predictionFileName.set(file.name);
    this.error.set('');
    this.busy.set(true);
    this.status.set('Чтение файла для предсказания...');

    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      setTimeout(() => {
        try {
          const rows = this.modelService.parse(text);
          if (rows.length === 0) throw new Error('Файл не содержит строк с данными.');
          const summary = this.modelService.predictOn(rows);
          this.status.set(
            `Готово: ${summary.totalStudents} студентов, из них в зоне риска ` +
              `${summary.highRisk + summary.mediumRisk}.`
          );
        } catch (e) {
          this.error.set((e as Error).message);
          this.status.set('');
        } finally {
          this.busy.set(false);
        }
      }, 30);
    };
    reader.onerror = () => {
      this.error.set('Не удалось прочитать файл.');
      this.busy.set(false);
    };
    reader.readAsText(file, 'utf-8');
    input.value = '';
  }

  exportModel(): void {
    this.modelService.exportModel();
  }

  onImportModel(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        this.modelService.importModel(String(reader.result ?? ''));
        this.status.set('Модель загружена из файла.');
        this.error.set('');
      } catch (e) {
        this.error.set((e as Error).message);
      }
    };
    reader.readAsText(file, 'utf-8');
    input.value = '';
  }

  clearModel(): void {
    this.modelService.clear();
    this.destroyCharts();
    this.status.set('Модель удалена.');
  }

  // ---- formatting helpers used by the template --------------------------

  pct(x: number): string {
    return `${(x * 100).toFixed(1)}%`;
  }

  num(x: number, digits = 2): string {
    return x.toFixed(digits);
  }

  riskLabel(r: RiskLevel): string {
    return r === 'high' ? 'Высокий риск' : r === 'medium' ? 'Средний риск' : 'Низкий риск';
  }

  trackStudent = (_: number, s: StudentPrediction) => s.studentId;
  trackPair = (_: number, p: CorrelationPair) => p.a + '|' + p.b;

  // ---- charts -----------------------------------------------------------

  private destroyCharts(): void {
    for (const c of this.charts) c.destroy();
    this.charts = [];
  }

  private renderCharts(): void {
    const trends = this.trends();
    if (!trends) return;
    this.destroyCharts();

    const accent = '#0097a7';
    const accent2 = '#ef6c00';

    const attn = this.attendanceCanvas()?.nativeElement;
    if (attn) {
      this.charts.push(
        new Chart(attn, {
          type: 'line',
          data: {
            labels: trends.attendanceBySemester.map((d) => `Сем. ${d.semester}`),
            datasets: [
              {
                label: 'Средняя посещаемость, %',
                data: trends.attendanceBySemester.map((d) => Math.round(d.avgAttendance * 10) / 10),
                borderColor: accent,
                backgroundColor: 'rgba(0,151,167,0.15)',
                fill: true,
                tension: 0.3,
              },
              {
                label: 'Доля сдавших экзамен, %',
                data: trends.passRateBySemester.map((d) => Math.round(d.passRate * 1000) / 10),
                borderColor: accent2,
                backgroundColor: 'rgba(239,108,0,0.1)',
                fill: false,
                tension: 0.3,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { y: { suggestedMin: 0, suggestedMax: 100 } },
          },
        })
      );
    }

    const examBySubject = this.examBySubjectCanvas()?.nativeElement;
    if (examBySubject) {
      const stats = trends.subjectStats;
      this.charts.push(
        new Chart(examBySubject, {
          type: 'bar',
          data: {
            labels: stats.map((s) => s.subject),
            datasets: [
              {
                label: 'Средний балл за экзамен',
                data: stats.map((s) => Math.round(s.avgExam * 100) / 100),
                backgroundColor: stats.map((s) => {
                  const avg = s.avgExam;
                  return avg < 4 ? '#e53935' : avg < 7 ? '#fb8c00' : '#43a047';
                }),
              },
            ],
          },
          options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { suggestedMin: 0, suggestedMax: 10 } },
          },
        })
      );
    }

    const attnSubject = this.attendanceSubjectCanvas()?.nativeElement;
    if (attnSubject) {
      const stats = [...trends.subjectStats].sort((a, b) => b.avgAttendance - a.avgAttendance);
      this.charts.push(
        new Chart(attnSubject, {
          type: 'bar',
          data: {
            labels: stats.map((s) => s.subject),
            datasets: [
              {
                label: 'Средняя посещаемость, %',
                data: stats.map((s) => Math.round(s.avgAttendance * 10) / 10),
                backgroundColor: '#26a69a',
              },
            ],
          },
          options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { suggestedMin: 0, suggestedMax: 100 } },
          },
        })
      );
    }

    const hist = this.histogramCanvas()?.nativeElement;
    if (hist) {
      this.charts.push(
        new Chart(hist, {
          type: 'bar',
          data: {
            labels: trends.examGradeHistogram.map((d) =>
              d.grade === 0 ? 'N/A' : String(d.grade)
            ),
            datasets: [
              {
                label: 'Количество экзаменационных оценок',
                data: trends.examGradeHistogram.map((d) => d.count),
                backgroundColor: trends.examGradeHistogram.map((d) =>
                  d.grade < 4 ? '#e53935' : d.grade < 7 ? '#fb8c00' : '#43a047'
                ),
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
          },
        })
      );
    }

    const gradeAttn = this.gradeByAttendanceCanvas()?.nativeElement;
    if (gradeAttn && trends.gradeByAttendance?.length) {
      const buckets = trends.gradeByAttendance.filter((d) => d.students > 0);
      this.charts.push(
        new Chart(gradeAttn, {
          type: 'bar',
          data: {
            labels: buckets.map((d) => d.label),
            datasets: [
              {
                label: 'Средний балл за экзамен',
                data: buckets.map((d) => Math.round(d.avgExam * 100) / 100),
                backgroundColor: buckets.map((d) =>
                  d.avgExam < 4 ? '#e53935' : d.avgExam < 7 ? '#fb8c00' : '#43a047'
                ),
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { suggestedMin: 0, suggestedMax: 10 } },
          },
        })
      );
    }

    const corr = this.correlationCanvas()?.nativeElement;
    if (corr) {
      const pairs = trends.topCorrelations;
      this.charts.push(
        new Chart(corr, {
          type: 'bar',
          data: {
            labels: pairs.map((p) => `${this.shortName(p.a)} ~ ${this.shortName(p.b)}`),
            datasets: [
              {
                label: 'Корреляция оценок (r)',
                data: pairs.map((p) => Math.round(p.r * 1000) / 1000),
                backgroundColor: '#1e88e5',
              },
            ],
          },
          options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { suggestedMin: 0, suggestedMax: 1 } },
          },
        })
      );
    }
  }

  shortName(s: string): string {
    return s.length > 22 ? s.slice(0, 21) + '…' : s;
  }
}
