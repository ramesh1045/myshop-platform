import { Component } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ThemeBase } from './theme-base';

/** BOUTIQUE (premium) theme — serif headings, announcement ribbon, split nav around a centred logo */
@Component({
  selector: 'theme-boutique',
  imports: [RouterOutlet, RouterLink, FormsModule],
  template: `
  <div class="sf-root boutique">
    @if (isPreview()) { <div class="sf-preview-bar">Preview of unpublished changes</div> }
    <div class="ribbon">Handcrafted with love · Shipping across India</div>
    <header>
      <nav class="l">
        <a routerLink="/products">Collections</a>
        @for (c of topCats().slice(0, 3); track c.id) { <a [routerLink]="['/category', c.slug]">{{ c.name }}</a> }
      </nav>
      <a routerLink="/" class="logo">@if (s().logoUrl) { <img [src]="s().logoUrl" [alt]="cfg().store.name" /> } @else { {{ cfg().store.name }} }</a>
      <nav class="r">
        @for (p of cfg().nav.pages.slice(0, 2); track p.slug) { <a [routerLink]="['/page', p.slug]">{{ p.title }}</a> }
        <a routerLink="/account">Account</a>
        <a routerLink="/cart">Bag ({{ cart.count() }})</a>
      </nav>
      <button class="burger" (click)="menuOpen.set(!menuOpen())">☰</button>
    </header>
    @if (menuOpen()) {
      <nav class="mobile">
        <a routerLink="/products" (click)="menuOpen.set(false)">Collections</a>
        @for (c of topCats(); track c.id) { <a [routerLink]="['/category', c.slug]" (click)="menuOpen.set(false)">{{ c.name }}</a> }
        @for (p of cfg().nav.pages; track p.slug) { <a [routerLink]="['/page', p.slug]" (click)="menuOpen.set(false)">{{ p.title }}</a> }
        @if (sf.hasModule('BLOG')) { <a routerLink="/blog" (click)="menuOpen.set(false)">Journal</a> }
        @if (sf.hasModule('BOOKING')) { <a routerLink="/booking" (click)="menuOpen.set(false)">Appointments</a> }
      </nav>
    }
    <main><router-outlet /></main>
    <footer>
      <div class="sf-wrap">
        <div class="logo">{{ cfg().store.name }}</div>
        <p>{{ cfg().seo.description }}</p>
        <div class="links"><a routerLink="/track">Track order</a>@for (p of cfg().nav.pages; track p.slug) { <a [routerLink]="['/page', p.slug]">{{ p.title }}</a> }
          @if (sf.hasModule('BLOG')) { <a routerLink="/blog">Journal</a> }</div>
        <small>© {{ year }}</small>
      </div>
    </footer>
  </div>`,
  styles: [`
    .ribbon { background: var(--sf-primary); color: #fff; text-align: center; font-size: 12px; letter-spacing: .12em; text-transform: uppercase; padding: 8px; }
    header { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; padding: 22px 32px; border-bottom: 1px solid color-mix(in srgb, var(--sf-text) 12%, transparent); background: var(--sf-bg); }
    nav.l, nav.r { display: flex; gap: 22px; font-size: 13px; letter-spacing: .08em; text-transform: uppercase; }
    nav.r { justify-content: flex-end; }
    .logo { font-family: var(--sf-heading-font); font-size: 30px; font-style: italic; text-align: center; } .logo img { max-height: 54px; margin: auto; }
    .burger { display: none; background: none; border: 0; font-size: 22px; color: inherit; justify-self: end; }
    .mobile { display: flex; flex-direction: column; gap: 12px; padding: 16px 24px; border-bottom: 1px solid color-mix(in srgb, var(--sf-text) 12%, transparent); }
    footer { background: var(--sf-surface); text-align: center; padding: 48px 0 28px; margin-top: 64px; }
    footer .links { display: flex; justify-content: center; gap: 20px; margin: 16px 0; text-transform: uppercase; font-size: 12px; letter-spacing: .08em; }
    @media (max-width: 800px) { nav.l, nav.r { display: none; } .burger { display: block; } header { grid-template-columns: 1fr auto 1fr; padding: 16px; } }
  `],
})
export class BoutiqueLayout extends ThemeBase {}
