import { Injectable, signal } from '@angular/core';
import { parsePerfCsv } from './csv';
import { predict, train } from './engine';
import { PerfRow, PredictionSummary, TrainedModel } from './types';

const STORAGE_KEY = 'apm.trained-model.v1';

@Injectable({ providedIn: 'root' })
export class ModelService {
  /** the currently loaded / trained model (persisted in localStorage) */
  readonly model = signal<TrainedModel | null>(null);
  /** whether the active model was restored from storage on startup */
  readonly restoredFromStorage = signal(false);
  readonly prediction = signal<PredictionSummary | null>(null);

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as TrainedModel;
      if (parsed && Array.isArray(parsed.weights)) {
        this.model.set(parsed);
        this.restoredFromStorage.set(true);
      }
    } catch {
      // ignore corrupt storage
    }
  }

  private saveToStorage(model: TrainedModel): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(model));
    } catch {
      // storage may be full / unavailable; the in-memory model still works
    }
  }

  parse(text: string): PerfRow[] {
    return parsePerfCsv(text);
  }

  /** Train on a parsed training set, persist the result and return it. */
  trainOn(rows: PerfRow[]): TrainedModel {
    const model = train(rows);
    this.model.set(model);
    this.restoredFromStorage.set(false);
    this.prediction.set(null);
    this.saveToStorage(model);
    return model;
  }

  /** Run predictions for an additional CSV against the active model. */
  predictOn(rows: PerfRow[]): PredictionSummary {
    const model = this.model();
    if (!model) throw new Error('Сначала обучите модель.');
    const summary = predict(model, rows);
    this.prediction.set(summary);
    return summary;
  }

  clear(): void {
    this.model.set(null);
    this.prediction.set(null);
    this.restoredFromStorage.set(false);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  /** Export the trained model as a downloadable .json file. */
  exportModel(): void {
    const model = this.model();
    if (!model) return;
    const blob = new Blob([JSON.stringify(model, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `academic-model-${model.trainedAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Import a previously exported model file. */
  importModel(text: string): void {
    const parsed = JSON.parse(text) as TrainedModel;
    if (!parsed || !Array.isArray(parsed.weights)) throw new Error('Некорректный файл модели.');
    this.model.set(parsed);
    this.restoredFromStorage.set(false);
    this.prediction.set(null);
    this.saveToStorage(parsed);
  }
}
