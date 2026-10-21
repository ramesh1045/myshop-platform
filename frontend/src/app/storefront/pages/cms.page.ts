import { Component, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../../shared/api.service';
import { StorefrontService } from '../storefront.service';
import { SectionsComponent } from '../components';

/** Page-builder pages: About, Gallery, Contact ... (PDF §9) */
@Component({
  selector: 'sf-cms',
  imports: [SectionsComponent, RouterLink],
  template: `
    @if (page(); as p) {
      <div class="sf-wrap"><h1 class="sf-page-title">{{ p.title }}</h1></div>
      <sf-sections [sections]="p.sections" [forms]="p.forms" />
    } @else if (missing()) { <div class="sf-wrap"><h1 class="sf-page-title">Page not found</h1><a routerLink="/">Go home</a></div> }`,
})
export class CmsPage {
  slug = input.required<string>();
  page = signal<any>(null); missing = signal(false);
  private api = inject(Api); private sf = inject(StorefrontService);
  constructor() {
    effect(() => {
      const s = this.slug();
      this.page.set(null); this.missing.set(false);
      this.api.get(`/api/public/pages/${s}`).then((p) => { this.page.set(p); this.sf.setSeo(p.seo_title || p.title, p.seo_description); })
        .catch(() => this.missing.set(true));
    });
  }
}

@Component({
  selector: 'sf-404',
  imports: [RouterLink],
  template: `<div class="sf-wrap" style="padding:60px 16px;text-align:center"><h1>Page not found</h1><a class="sf-btn" routerLink="/">Go to home</a></div>`,
})
export class NotFoundPage {}
