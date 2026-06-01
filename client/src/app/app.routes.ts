import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./dashboard/dashboard').then((m) => m.Dashboard),
    title: 'Прогноз успеваемости',
  },
  {
    path: 'excel',
    loadComponent: () =>
      import('./excel-merge-page/excel-merge-page').then((m) => m.ExcelMergePage),
    title: 'Объединение Excel',
  },
  { path: '**', redirectTo: '' },
];
