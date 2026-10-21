import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastsComponent } from './shared/ui';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ToastsComponent],
  template: `<router-outlet /><ms-toasts />`,
})
export class App {}
