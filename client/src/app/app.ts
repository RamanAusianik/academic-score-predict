import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatTabsModule } from '@angular/material/tabs';
import { MatToolbarModule } from '@angular/material/toolbar';
import { SlicePipe } from '@angular/common';
import { ModelService } from './model/model.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatTabsModule, MatToolbarModule, SlicePipe],
  templateUrl: './app.html',
  styleUrl: './app.sass',
})
export class App {
  private readonly modelService = inject(ModelService);

  readonly model = this.modelService.model;
}
