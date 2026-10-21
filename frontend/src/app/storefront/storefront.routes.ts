import { Component, Type, inject, signal } from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { ResolveFn, Routes } from '@angular/router';
import { StorefrontService, StorefrontConfig } from './storefront.service';
import { THEME_REGISTRY } from './themes/theme-base';

const configResolver: ResolveFn<StorefrontConfig> = () => inject(StorefrontService).load();

/** Picks the theme layout (layer 1) and lazy-loads it; shows a notice when the store is suspended */
@Component({
  selector: 'sf-shell',
  imports: [NgComponentOutlet],
  template: `
    @if (sf.config()?.store?.suspended) {
      <div class="auth-page"><div class="card" style="max-width:480px;text-align:center">
        <h1>{{ sf.config()!.store.name }}</h1>
        <p>This store is temporarily unavailable. Please check back soon.</p>
      </div></div>
    } @else if (layout()) {
      <ng-container *ngComponentOutlet="layout()" />
    }`,
})
export class StorefrontShell {
  sf = inject(StorefrontService);
  layout = signal<Type<unknown> | null>(null);
  constructor() {
    const code = this.sf.config()?.theme.code ?? 'classic';
    (THEME_REGISTRY[code] ?? THEME_REGISTRY['classic'])().then((c) => this.layout.set(c));
  }
}

export const STOREFRONT_ROUTES: Routes = [
  {
    path: '', component: StorefrontShell, resolve: { config: configResolver },
    children: [
      { path: '', loadComponent: () => import('./pages/home.page').then((m) => m.HomePage) },
      { path: 'products', loadComponent: () => import('./pages/product-list.page').then((m) => m.ProductListPage) },
      { path: 'category/:slug', loadComponent: () => import('./pages/product-list.page').then((m) => m.ProductListPage) },
      { path: 'product/:slug', loadComponent: () => import('./pages/product-detail.page').then((m) => m.ProductDetailPage) },
      { path: 'cart', loadComponent: () => import('./pages/cart.page').then((m) => m.CartPage) },
      { path: 'checkout', loadComponent: () => import('./pages/checkout.page').then((m) => m.CheckoutPage) },
      { path: 'order/:number', loadComponent: () => import('./pages/order-success.page').then((m) => m.OrderSuccessPage) },
      { path: 'track', loadComponent: () => import('./pages/track.page').then((m) => m.TrackPage) },
      { path: 'account', loadComponent: () => import('./pages/account.page').then((m) => m.AccountPage) },
      { path: 'page/:slug', loadComponent: () => import('./pages/cms.page').then((m) => m.CmsPage) },
      { path: 'blog', loadComponent: () => import('./pages/blog.page').then((m) => m.BlogListPage) },
      { path: 'blog/:slug', loadComponent: () => import('./pages/blog.page').then((m) => m.BlogPostPage) },
      { path: 'booking', loadComponent: () => import('./pages/booking.page').then((m) => m.BookingPage) },
      { path: '**', loadComponent: () => import('./pages/cms.page').then((m) => m.NotFoundPage) },
    ],
  },
];
