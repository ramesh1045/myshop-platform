import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml, SafeResourceUrl } from '@angular/platform-browser';
import { Api, errMsg } from '../shared/api.service';
import { InrPipe, Toast } from '../shared/ui';
import { CartService } from './cart.service';
import { Section, StorefrontService } from './storefront.service';

// ------------------------------------------------------------------ product card (theme decides style)
@Component({
  selector: 'sf-product-card',
  imports: [RouterLink, InrPipe],
  template: `
    <div class="pc" [attr.data-style]="style()">
      <a [routerLink]="['/product', p().slug]" class="pc-img">
        <img [src]="p().images?.[0]?.url || placeholder" [alt]="p().name" loading="lazy" />
        @if (p().compare_at_price && p().compare_at_price > p().price) {
          <span class="pc-off">{{ off() }}% OFF</span>
        }
      </a>
      <div class="pc-body">
        <a [routerLink]="['/product', p().slug]" class="pc-name">{{ p().name }}</a>
        <div class="pc-price">
          <b>{{ p().price | inr }}</b>
          @if (p().compare_at_price && p().compare_at_price > p().price) { <s>{{ p().compare_at_price | inr }}</s> }
        </div>
        @if (p().track_inventory && p().stock_qty <= 0) {
          <button class="sf-btn ghost" disabled>Out of stock</button>
        } @else {
          <button class="sf-btn" (click)="add()">Add to cart</button>
        }
      </div>
    </div>`,
  styles: [`
    .pc { background: var(--sf-bg); border-radius: var(--sf-radius); overflow: hidden; display: flex; flex-direction: column; height: 100%; position: relative; }
    .pc[data-style=bordered] { border: 1px solid color-mix(in srgb, var(--sf-text) 12%, transparent); }
    .pc[data-style=minimal] .pc-body { padding: 10px 2px; }
    .pc-img { position: relative; aspect-ratio: 4/5; background: var(--sf-surface); overflow: hidden; display: block; }
    .pc-img img { width: 100%; height: 100%; object-fit: cover; transition: transform .3s; }
    .pc:hover .pc-img img { transform: scale(1.04); }
    .pc-off { position: absolute; top: 8px; left: 8px; background: var(--sf-accent); color: #fff; font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: var(--sf-radius); }
    .pc-body { padding: 12px; display: flex; flex-direction: column; gap: 6px; flex: 1; }
    .pc-name { color: var(--sf-text); font-weight: 500; line-height: 1.3; }
    .pc-price { display: flex; gap: 8px; align-items: baseline; }
    .pc-price s { color: color-mix(in srgb, var(--sf-text) 50%, transparent); font-size: 12px; }
    .pc .sf-btn { margin-top: auto; }
    .pc[data-style=overlay] .pc-body { position: absolute; inset: auto 0 0 0; background: linear-gradient(transparent, rgba(0,0,0,.75)); color: #fff; padding-top: 40px; }
    .pc[data-style=overlay] .pc-name, .pc[data-style=overlay] .pc-price { color: #fff; }
  `],
})
export class ProductCardComponent {
  p = input.required<any>();
  private cart = inject(CartService);
  private toast = inject(Toast);
  private sf = inject(StorefrontService);
  style = computed(() => this.sf.settings().productCardStyle || 'bordered');
  placeholder = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 5"><rect width="4" height="5" fill="%23eee"/></svg>';
  off = computed(() => Math.round((1 - this.p().price / this.p().compare_at_price) * 100));
  add() { this.cart.add(this.p()); this.toast.ok(`${this.p().name} added to cart`); }
}

// ------------------------------------------------------------------ product grid loader used by sections
@Component({
  selector: 'sf-product-strip',
  imports: [ProductCardComponent],
  template: `<div class="sf-grid">@for (p of items(); track p.id) { <sf-product-card [p]="p" /> }</div>`,
})
export class ProductStripComponent implements OnInit {
  featured = input(false);
  limit = input(8);
  category = input<string | null>(null);
  items = signal<any[]>([]);
  private api = inject(Api);
  async ngOnInit() {
    const r = await this.api.get('/api/public/products', { size: this.limit(), featured: this.featured() ? 1 : undefined, category: this.category() ?? undefined });
    this.items.set(r.items);
  }
}

// ------------------------------------------------------------------ embedded form (form builder, PDF §9)
@Component({
  selector: 'sf-form',
  imports: [FormsModule],
  template: `
    @if (form(); as f) {
      @if (done()) { <div class="sf-note">{{ done() }}</div> } @else {
      <form class="sf-form" (ngSubmit)="submit()">
        @for (fl of f.fields; track fl.key) {
          <label>
            <span>{{ fl.label }}@if (fl.required) {*}</span>
            @switch (fl.type) {
              @case ('textarea') { <textarea [(ngModel)]="data[fl.key]" [name]="fl.key" [required]="fl.required"></textarea> }
              @case ('select') { <select [(ngModel)]="data[fl.key]" [name]="fl.key" [required]="fl.required">@for (o of fl.options || []; track o) {<option [value]="o">{{ o }}</option>}</select> }
              @case ('checkbox') { <input type="checkbox" [(ngModel)]="data[fl.key]" [name]="fl.key" /> }
              @default { <input [type]="fl.type" [(ngModel)]="data[fl.key]" [name]="fl.key" [required]="fl.required" /> }
            }
          </label>
        }
        <button class="sf-btn" [disabled]="busy()">Submit</button>
      </form>
      }
    }`,
})
export class EmbeddedFormComponent implements OnInit {
  formId = input.required<number>();
  preset = input<any>(null);
  form = signal<any>(null);
  data: Record<string, any> = {};
  done = signal(''); busy = signal(false);
  private api = inject(Api); private toast = inject(Toast);
  async ngOnInit() { this.form.set(this.preset() ?? await this.api.get(`/api/public/forms/${this.formId()}`).catch(() => null)); }
  async submit() {
    this.busy.set(true);
    try { const r = await this.api.post(`/api/public/forms/${this.formId()}/submit`, this.data); this.done.set(r.message); }
    catch (e) { this.toast.err(errMsg(e)); } finally { this.busy.set(false); }
  }
}

// ------------------------------------------------------------------ SECTION RENDERER (PDF §5.4 layer 3, §9 page builder)
@Component({
  selector: 'sf-sections',
  imports: [RouterLink, ProductStripComponent, EmbeddedFormComponent, FormsModule],
  template: `
    @for (s of visible(); track s.id) {
      <section class="sf-section" [attr.data-type]="s.type">
        @switch (s.type) {
          @case ('HERO_BANNER') {
            <div class="sf-hero" [style.background-image]="bg(s.config['imageUrl'] || sf.settings().bannerUrl)">
              <div class="sf-hero-inner">
                <h1>{{ s.config['title'] }}</h1>
                @if (s.config['subtitle']) { <p>{{ s.config['subtitle'] }}</p> }
                @if (s.config['ctaText']) { <a class="sf-btn lg" [routerLink]="s.config['ctaLink'] || '/products'">{{ s.config['ctaText'] }}</a> }
              </div>
            </div>
          }
          @case ('CATEGORY_GRID') {
            <div class="sf-wrap">
              @if (s.config['title']) { <h2 class="sf-h">{{ s.config['title'] }}</h2> }
              <div class="sf-cats">
                @for (c of topCats().slice(0, s.config['limit'] || 6); track c.id) {
                  <a class="sf-cat" [routerLink]="['/category', c.slug]">
                    @if (c.image_url) { <img [src]="c.image_url" [alt]="c.name" loading="lazy" /> }
                    <span>{{ c.name }}</span>
                  </a>
                }
              </div>
            </div>
          }
          @case ('FEATURED_PRODUCTS') {
            <div class="sf-wrap">@if (s.config['title']) { <h2 class="sf-h">{{ s.config['title'] }}</h2> }<sf-product-strip [featured]="true" [limit]="s.config['limit'] || 8" /></div>
          }
          @case ('NEW_ARRIVALS') {
            <div class="sf-wrap">@if (s.config['title']) { <h2 class="sf-h">{{ s.config['title'] }}</h2> }<sf-product-strip [limit]="s.config['limit'] || 8" [category]="s.config['category'] || null" /></div>
          }
          @case ('RICH_TEXT') { <div class="sf-wrap sf-rich" [innerHTML]="html(s.config['html'])"></div> }
          @case ('IMAGE_WITH_TEXT') {
            <div class="sf-wrap sf-iwt" [class.rev]="s.config['imageRight']">
              @if (s.config['imageUrl']) { <img [src]="s.config['imageUrl']" [alt]="s.config['title'] || ''" loading="lazy" /> }
              <div><h2 class="sf-h">{{ s.config['title'] }}</h2><div [innerHTML]="html(s.config['html'] || s.config['text'])"></div></div>
            </div>
          }
          @case ('GALLERY') {
            <div class="sf-wrap">@if (s.config['title']) { <h2 class="sf-h">{{ s.config['title'] }}</h2> }
              <div class="sf-gallery">@for (img of s.config['images'] || []; track $index) { <img [src]="img" loading="lazy" alt="" /> }</div></div>
          }
          @case ('TESTIMONIALS') {
            <div class="sf-wrap">@if (s.config['title']) { <h2 class="sf-h">{{ s.config['title'] }}</h2> }
              <div class="sf-testi">@for (t of s.config['items'] || []; track $index) { <blockquote><p>“{{ t.text }}”</p><cite>— {{ t.name }}</cite></blockquote> }</div></div>
          }
          @case ('NEWSLETTER') {
            <div class="sf-wrap sf-news"><h2 class="sf-h">{{ s.config['title'] || 'Stay in touch' }}</h2><p>{{ s.config['text'] }}</p>
              @if (s.config['formId']) { <sf-form [formId]="s.config['formId']" /> }</div>
          }
          @case ('FORM') { <div class="sf-wrap"><sf-form [formId]="s.config['formId']" [preset]="formFor(s.config['formId'])" /></div> }
          @case ('VIDEO') {
            @if (video(s.config['url']); as v) { <div class="sf-wrap"><div class="sf-video"><iframe [src]="v" allowfullscreen loading="lazy"></iframe></div></div> }
          }
          @case ('SPACER') { <div [style.height.px]="s.config['height'] || 40"></div> }
          @case ('BLOG_POSTS') {
            @if (sf.hasModule('BLOG')) { <div class="sf-wrap"><h2 class="sf-h">{{ s.config['title'] || 'From our blog' }}</h2><a class="sf-btn ghost" routerLink="/blog">Read the blog</a></div> }
          }
          @case ('BOOKING_CTA') {
            @if (sf.hasModule('BOOKING')) { <div class="sf-wrap sf-news"><h2 class="sf-h">{{ s.config['title'] || 'Book an appointment' }}</h2><a class="sf-btn lg" routerLink="/booking">Book now</a></div> }
          }
        }
      </section>
    }`,
})
export class SectionsComponent {
  sections = input<Section[]>([]);
  forms = input<any[]>([]);
  sf = inject(StorefrontService);
  private san = inject(DomSanitizer);
  visible = computed(() => this.sections().filter((s) => s.enabled !== false));
  topCats = computed(() => (this.sf.config()?.nav.categories ?? []).filter((c) => !c.parent_id));
  bg(url?: string) { return url ? `url("${url}")` : null; }
  /** Rich text is written by the store owner (trusted tenant admin) */
  html(h?: string): SafeHtml { return this.san.bypassSecurityTrustHtml(h || ''); }
  formFor(id: number) { return this.forms().find((f) => f.id === id) ?? null; }
  video(url?: string): SafeResourceUrl | null {
    if (!url) return null;
    const m = url.match(/(?:youtu\.be\/|v=)([\w-]{11})/);
    return m ? this.san.bypassSecurityTrustResourceUrl(`https://www.youtube-nocookie.com/embed/${m[1]}`) : null;
  }
}
