import { Component, HostListener, computed, effect, inject, input, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { Api } from '../../shared/api.service';
import { StorefrontService } from '../storefront.service';
import { ProductCardComponent } from '../components';

/** Product listing with infinite scroll -> cursor pagination (PDF §8) */
@Component({
  selector: 'sf-product-list',
  imports: [ProductCardComponent, RouterLink],
  template: `
    <div class="sf-wrap">
      <div class="sf-crumbs"><a routerLink="/">Home</a> / {{ heading() }}</div>
      <h1 class="sf-page-title">{{ heading() }}</h1>
      @if (subCats().length) {
        <div class="chips">@for (c of subCats(); track c.id) { <a class="sf-btn ghost" [routerLink]="['/category', c.slug]">{{ c.name }}</a> }</div>
      }
      <div class="sf-grid">@for (p of items(); track p.id) { <sf-product-card [p]="p" /> }</div>
      @if (!loading() && !items().length) { <p>No products found.</p> }
      @if (loading()) { <p style="text-align:center;padding:20px">Loading…</p> }
      @if (cursor() && !loading()) { <div style="text-align:center;margin:24px"><button class="sf-btn ghost" (click)="more()">Load more</button></div> }
    </div>`,
  styles: [`.chips { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }`],
})
export class ProductListPage {
  slug = input<string>();
  private api = inject(Api);
  private sf = inject(StorefrontService);
  private qp = toSignal(inject(ActivatedRoute).queryParamMap);
  items = signal<any[]>([]);
  cursor = signal<string | null>(null);
  loading = signal(false);
  cat = computed(() => this.sf.config()?.nav.categories.find((c) => c.slug === this.slug()));
  subCats = computed(() => this.cat() ? this.sf.config()!.nav.categories.filter((c) => c.parent_id === this.cat()!.id) : []);
  heading = computed(() => this.qp()?.get('q') ? `Search: “${this.qp()!.get('q')}”` : this.cat()?.name ?? 'All products');

  constructor() {
    effect(() => {
      this.slug(); this.qp();
      this.items.set([]); this.cursor.set(null);
      this.sf.setSeo(this.heading());
      queueMicrotask(() => this.fetch());
    });
  }
  async fetch() {
    this.loading.set(true);
    try {
      const r = await this.api.get('/api/public/products', { size: 24, cursor: this.cursor() ?? undefined, category: this.slug(), q: this.qp()?.get('q') ?? undefined });
      this.items.update((l) => [...l, ...r.items]);
      this.cursor.set(r.nextCursor);
    } finally { this.loading.set(false); }
  }
  more() { if (this.cursor()) this.fetch(); }
  @HostListener('window:scroll')
  onScroll() {
    if (!this.loading() && this.cursor() && window.innerHeight + window.scrollY > document.body.offsetHeight - 600) this.fetch();
  }
}
