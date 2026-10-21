import { Component, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DomSanitizer } from '@angular/platform-browser';
import { Api } from '../../shared/api.service';
import { InrPipe, Toast } from '../../shared/ui';
import { CartService } from '../cart.service';
import { StorefrontService } from '../storefront.service';
import { ProductCardComponent } from '../components';

@Component({
  selector: 'sf-product-detail',
  imports: [RouterLink, InrPipe, ProductCardComponent],
  template: `
    @if (p(); as p) {
      <div class="sf-wrap">
        <div class="sf-crumbs"><a routerLink="/">Home</a> /
          @if (p.category_slug) { <a [routerLink]="['/category', p.category_slug]">{{ p.category_name }}</a> / } {{ p.name }}</div>
        <div class="pd">
          <div class="gallery">
            <img class="main" [src]="img() || p.images[0]?.url" [alt]="p.name" />
            @if (p.images.length > 1) {
              <div class="thumbs">@for (i of p.images; track i.url) { <img [src]="i.url" (click)="img.set(i.url)" [alt]="i.alt || p.name" /> }</div>
            }
          </div>
          <div class="info">
            <h1>{{ p.name }}</h1>
            <div class="price"><b>{{ p.price | inr }}</b>
              @if (p.compare_at_price > p.price) { <s>{{ p.compare_at_price | inr }}</s> <span class="save">Save {{ (p.compare_at_price - p.price) | inr }}</span> }</div>
            <small class="tax">{{ sf.config()!.checkout.pricesIncludeTax ? 'Inclusive of all taxes' : '+ GST ' + p.gst_rate + '%' }}</small>
            @if (p.short_description) { <p>{{ p.short_description }}</p> }
            @if (p.track_inventory && p.stock_qty <= 0) { <p class="oos">Out of stock</p> } @else {
              <div class="buy">
                <div class="sf-qty"><button (click)="qty.set(Math.max(1, qty() - 1))">−</button><span>{{ qty() }}</span><button (click)="qty.set(qty() + 1)">+</button></div>
                <button class="sf-btn lg" (click)="add(false)">Add to cart</button>
                <button class="sf-btn lg ghost" (click)="add(true)">Buy now</button>
              </div>
              @if (p.track_inventory && p.stock_qty <= 5) { <small class="oos">Only {{ p.stock_qty }} left</small> }
            }
            @if (p.description) { <div class="desc sf-rich" [innerHTML]="desc()"></div> }
          </div>
        </div>
        @if (p.related.length) { <h2 class="sf-h" style="margin-top:40px">You may also like</h2><div class="sf-grid">@for (r of p.related; track r.id) { <sf-product-card [p]="r" /> }</div> }
      </div>
    } @else if (missing()) { <div class="sf-wrap"><h1 class="sf-page-title">Product not found</h1><a routerLink="/products">Browse products</a></div> }`,
  styles: [`
    .pd { display: grid; grid-template-columns: 1.1fr 1fr; gap: 36px; }
    .main { width: 100%; aspect-ratio: 4/5; object-fit: cover; border-radius: var(--sf-radius); background: var(--sf-surface); }
    .thumbs { display: flex; gap: 8px; margin-top: 8px; } .thumbs img { width: 70px; height: 80px; object-fit: cover; border-radius: var(--sf-radius); cursor: pointer; }
    .info { display: flex; flex-direction: column; gap: 12px; }
    .price { display: flex; gap: 10px; align-items: baseline; font-size: 22px; } .price s { font-size: 15px; opacity: .6; }
    .save { font-size: 13px; color: var(--sf-accent); font-weight: 700; }
    .tax { opacity: .7; } .buy { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; } .oos { color: #c2410c; font-weight: 600; }
    .desc { margin-top: 12px; border-top: 1px solid color-mix(in srgb, var(--sf-text) 10%, transparent); padding-top: 12px; }
    @media (max-width: 800px) { .pd { grid-template-columns: 1fr; } }
  `],
})
export class ProductDetailPage {
  slug = input.required<string>();
  Math = Math;
  sf = inject(StorefrontService);
  private api = inject(Api); private cart = inject(CartService); private toast = inject(Toast);
  private router = inject(Router); private san = inject(DomSanitizer);
  p = signal<any>(null); missing = signal(false); img = signal<string | null>(null); qty = signal(1);
  desc = () => this.san.bypassSecurityTrustHtml(this.p()?.description || '');

  constructor() {
    effect(() => {
      const slug = this.slug();
      this.p.set(null); this.img.set(null); this.qty.set(1);
      this.api.get(`/api/public/products/${slug}`).then((p) => {
        this.p.set(p);
        this.sf.setSeo(p.seo_title || p.name, p.seo_description || p.short_description, {
          '@context': 'https://schema.org', '@type': 'Product', name: p.name, image: p.images.map((i: any) => i.url), description: p.short_description,
          sku: p.sku, offers: { '@type': 'Offer', priceCurrency: 'INR', price: p.price, availability: p.track_inventory && p.stock_qty <= 0 ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock' },
        });
      }).catch(() => this.missing.set(true));
    });
  }
  add(buyNow: boolean) {
    this.cart.add(this.p(), this.qty());
    if (buyNow) this.router.navigateByUrl('/checkout'); else this.toast.ok('Added to cart');
  }
}
