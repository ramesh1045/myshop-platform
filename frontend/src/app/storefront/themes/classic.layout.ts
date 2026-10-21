import { Component } from '@angular/core';
import { RouterLink, RouterOutlet, RouterLinkActive } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ThemeBase } from './theme-base';

/** CLASSIC theme — top bar, logo left, search centre, category bar, 4-column footer */
@Component({
  selector: 'theme-classic',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, FormsModule],
  template: `
  <div class="sf-root classic">
    @if (isPreview()) { <div class="sf-preview-bar">Preview of unpublished changes</div> }
    <div class="topline">@if (cfg().store.contact.phone) { Call us: {{ cfg().store.contact.phone }} } <span class="sp"></span> @if (cfg().checkout.freeShippingAbove) { Free shipping above ₹{{ cfg().checkout.freeShippingAbove }} } @else { Shipping across India }</div>
    <header>
      <div class="sf-wrap bar">
        <button class="burger" (click)="menuOpen.set(!menuOpen())" aria-label="Menu">☰</button>
        <a routerLink="/" class="logo">
          @if (s().logoUrl) { <img [src]="s().logoUrl" [alt]="cfg().store.name" /> } @else { {{ cfg().store.name }} }
        </a>
        <form class="search" (ngSubmit)="search()"><input [(ngModel)]="q" name="q" placeholder="Search products…" /></form>
        <nav class="icons">
          <a routerLink="/account">{{ auth.customerLoggedIn() ? 'My account' : 'Login' }}</a>
          <a routerLink="/cart" class="cart">Cart <b>{{ cart.count() }}</b></a>
        </nav>
      </div>
      <nav class="cats" [class.open]="menuOpen()">
        <div class="sf-wrap">
          <a routerLink="/products" routerLinkActive="on" (click)="menuOpen.set(false)">All products</a>
          @for (c of topCats(); track c.id) { <a [routerLink]="['/category', c.slug]" routerLinkActive="on" (click)="menuOpen.set(false)">{{ c.name }}</a> }
          @for (p of cfg().nav.pages; track p.slug) { <a [routerLink]="['/page', p.slug]" routerLinkActive="on" (click)="menuOpen.set(false)">{{ p.title }}</a> }
          @if (sf.hasModule('BLOG')) { <a routerLink="/blog" (click)="menuOpen.set(false)">Blog</a> }
          @if (sf.hasModule('BOOKING')) { <a routerLink="/booking" (click)="menuOpen.set(false)">Book</a> }
        </div>
      </nav>
    </header>
    <main><router-outlet /></main>
    <footer>
      <div class="sf-wrap cols">
        <div><b>{{ cfg().store.name }}</b><p>{{ cfg().seo.description }}</p></div>
        <div><b>Shop</b>@for (c of topCats(); track c.id) { <a [routerLink]="['/category', c.slug]">{{ c.name }}</a> }</div>
        <div><b>Help</b><a routerLink="/track">Track order</a>@for (p of cfg().nav.pages; track p.slug) { <a [routerLink]="['/page', p.slug]">{{ p.title }}</a> }</div>
        <div><b>Contact</b>
          @if (cfg().store.contact.phone) { <span>{{ cfg().store.contact.phone }}</span> }
          @if (cfg().store.contact.email) { <span>{{ cfg().store.contact.email }}</span> }
          @if (cfg().store.contact.whatsapp) { <a [href]="'https://wa.me/' + cfg().store.contact.whatsapp" target="_blank" rel="noopener">WhatsApp</a> }
        </div>
      </div>
      <div class="copy">© {{ year }} {{ cfg().store.name }}</div>
    </footer>
  </div>`,
  styles: [`
    .topline { background: var(--sf-secondary); color: #fff; font-size: 12px; padding: 6px 16px; display: flex; }
    .topline .sp { flex: 1; }
    header { background: var(--sf-bg); border-bottom: 1px solid color-mix(in srgb, var(--sf-text) 10%, transparent); position: sticky; top: 0; z-index: 20; }
    .bar { display: flex; align-items: center; gap: 18px; padding-top: 14px; padding-bottom: 14px; }
    .logo { font-weight: 800; font-size: 22px; color: var(--sf-primary) !important; } .logo img { max-height: 44px; }
    .search { flex: 1; max-width: 520px; }
    .icons { display: flex; gap: 18px; font-weight: 500; }
    .cart b { background: var(--sf-primary); color: #fff; border-radius: 999px; padding: 1px 7px; font-size: 12px; }
    .cats { border-top: 1px solid color-mix(in srgb, var(--sf-text) 8%, transparent); }
    .cats .sf-wrap { display: flex; gap: 22px; overflow-x: auto; padding-top: 10px; padding-bottom: 10px; }
    .cats a { white-space: nowrap; font-weight: 500; } .cats a.on { color: var(--sf-primary); }
    .burger { display: none; background: none; border: 0; font-size: 22px; cursor: pointer; color: inherit; }
    footer { background: var(--sf-secondary); color: #e5e7eb; margin-top: 48px; }
    .cols { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap: 24px; padding-top: 36px; padding-bottom: 24px; }
    .cols div { display: flex; flex-direction: column; gap: 8px; } .cols b { color: #fff; }
    .copy { text-align: center; font-size: 12px; padding: 12px; border-top: 1px solid rgba(255,255,255,.1); }
    @media (max-width: 800px) {
      .burger { display: block; } .search { display: none; } .cats { display: none; } .cats.open { display: block; }
      .cats.open .sf-wrap { flex-direction: column; } .cols { grid-template-columns: 1fr 1fr; }
    }
  `],
})
export class ClassicLayout extends ThemeBase {}
