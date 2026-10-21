import { Component } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ThemeBase } from './theme-base';

/** MODERN theme — centred logo, transparent floating nav, slide-in menu, minimal footer */
@Component({
  selector: 'theme-modern',
  imports: [RouterOutlet, RouterLink, FormsModule],
  template: `
  <div class="sf-root modern">
    @if (isPreview()) { <div class="sf-preview-bar">Preview of unpublished changes</div> }
    <header>
      <button class="menu-btn" (click)="menuOpen.set(true)">Menu</button>
      <a routerLink="/" class="logo">@if (s().logoUrl) { <img [src]="s().logoUrl" [alt]="cfg().store.name" /> } @else { {{ cfg().store.name }} }</a>
      <div class="right">
        <a routerLink="/account" class="pill">{{ auth.customerLoggedIn() ? 'Account' : 'Sign in' }}</a>
        <a routerLink="/cart" class="pill solid">Bag · {{ cart.count() }}</a>
      </div>
    </header>
    @if (menuOpen()) {
      <div class="drawer-bg" (click)="menuOpen.set(false)"></div>
      <aside class="drawer">
        <button class="close" (click)="menuOpen.set(false)">✕</button>
        <form (ngSubmit)="search()"><input [(ngModel)]="q" name="q" placeholder="Search" /></form>
        <a routerLink="/products" (click)="menuOpen.set(false)">Shop all</a>
        @for (c of topCats(); track c.id) { <a [routerLink]="['/category', c.slug]" (click)="menuOpen.set(false)">{{ c.name }}</a> }
        <hr />
        @for (p of cfg().nav.pages; track p.slug) { <a [routerLink]="['/page', p.slug]" (click)="menuOpen.set(false)">{{ p.title }}</a> }
        @if (sf.hasModule('BLOG')) { <a routerLink="/blog" (click)="menuOpen.set(false)">Journal</a> }
        @if (sf.hasModule('BOOKING')) { <a routerLink="/booking" (click)="menuOpen.set(false)">Book a visit</a> }
        <a routerLink="/track" (click)="menuOpen.set(false)">Track order</a>
      </aside>
    }
    <main><router-outlet /></main>
    <footer>
      <div class="sf-wrap">
        <a routerLink="/" class="logo small">{{ cfg().store.name }}</a>
        <div class="links">@for (p of cfg().nav.pages; track p.slug) { <a [routerLink]="['/page', p.slug]">{{ p.title }}</a> }<a routerLink="/track">Track order</a></div>
        <small>© {{ year }} · {{ cfg().store.contact.email }}</small>
      </div>
    </footer>
  </div>`,
  styles: [`
    header { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; padding: 18px 24px; position: sticky; top: 0; z-index: 20;
      background: color-mix(in srgb, var(--sf-bg) 85%, transparent); backdrop-filter: blur(10px); }
    .logo { font-family: var(--sf-heading-font); font-weight: 700; font-size: 26px; letter-spacing: -.02em; text-align: center; } .logo img { max-height: 46px; margin: auto; }
    .logo.small { font-size: 18px; }
    .menu-btn { justify-self: start; background: none; border: 0; font: inherit; font-weight: 600; cursor: pointer; color: inherit; }
    .right { justify-self: end; display: flex; gap: 8px; }
    .pill { padding: 8px 14px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--sf-text) 20%, transparent); font-weight: 500; }
    .pill.solid { background: var(--sf-primary); color: #fff !important; border-color: var(--sf-primary); }
    .drawer-bg { position: fixed; inset: 0; background: rgba(0,0,0,.35); z-index: 40; }
    .drawer { position: fixed; left: 0; top: 0; bottom: 0; width: 300px; background: var(--sf-bg); z-index: 41; padding: 24px; display: flex; flex-direction: column; gap: 14px; font-size: 18px; }
    .drawer .close { align-self: flex-end; background: none; border: 0; font-size: 20px; cursor: pointer; color: inherit; }
    footer { border-top: 1px solid color-mix(in srgb, var(--sf-text) 10%, transparent); margin-top: 64px; padding: 32px 0; text-align: center; }
    footer .links { display: flex; justify-content: center; gap: 18px; margin: 12px 0; flex-wrap: wrap; }
  `],
})
export class ModernLayout extends ThemeBase {}
