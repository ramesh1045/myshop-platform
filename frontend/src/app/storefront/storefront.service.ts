import { Injectable, inject, signal, computed } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Meta, Title } from '@angular/platform-browser';
import { Api } from '../shared/api.service';

export interface Section { id: string; type: string; enabled: boolean; config: Record<string, any> }
export interface StorefrontConfig {
  store: { name: string; subdomain: string; currency: string; status: string; suspended: boolean; primaryDomain: string;
    contact: { email?: string; phone?: string; whatsapp?: string; city?: string; state?: string }; social: Record<string, string> };
  theme: { code: string; settings: any; sections: Section[]; version: number; stage: 'DRAFT' | 'PUBLISHED' };
  nav: { pages: { title: string; slug: string }[]; categories: { id: number; parent_id: number | null; name: string; slug: string; image_url: string | null }[] };
  modules: string[];
  checkout: { cod: boolean; online: boolean; razorpayKeyId: string | null; shippingFlatFee: number; freeShippingAbove: number | null; minOrderAmount: number; pricesIncludeTax: boolean };
  seo: { title: string; description: string; keywords: string; googleAnalyticsId: string | null };
}

/**
 * PDF §5.4: on start the Angular app calls /api/public/storefront-config and applies
 *   layer 1 theme (lazy-loaded layout), layer 2 colours/font/logo (CSS variables), layer 3 sections.
 * ?preview=<token> loads the DRAFT for the live preview in the admin panel.
 */
@Injectable({ providedIn: 'root' })
export class StorefrontService {
  private api = inject(Api);
  private doc = inject(DOCUMENT);
  private title = inject(Title);
  private meta = inject(Meta);

  readonly config = signal<StorefrontConfig | null>(null);
  readonly settings = computed(() => this.config()?.theme.settings ?? {});
  readonly hasModule = (m: string) => !!this.config()?.modules.includes(m);
  private loading: Promise<StorefrontConfig> | null = null;

  previewToken(): string | null {
    const q = new URLSearchParams(location.search).get('preview');
    if (q) sessionStorage.setItem('ms:preview', q);
    return q || sessionStorage.getItem('ms:preview');
  }

  load(): Promise<StorefrontConfig> {
    this.loading ??= this.api.get<StorefrontConfig>('/api/public/storefront-config', { preview: this.previewToken() ?? undefined })
      .then((c) => { this.config.set(c); this.apply(c); return c; });
    return this.loading;
  }

  /** Layer 2 -> CSS variables + Google font + favicon */
  private apply(c: StorefrontConfig) {
    const s = c.theme.settings || {};
    const col = s.colors || {};
    const root = this.doc.documentElement.style;
    const set = (k: string, v: any) => v != null && root.setProperty(k, String(v));
    set('--sf-primary', col.primary); set('--sf-secondary', col.secondary); set('--sf-bg', col.background);
    set('--sf-surface', col.surface); set('--sf-text', col.text); set('--sf-accent', col.accent);
    set('--sf-radius', `${s.borderRadius ?? 8}px`);
    set('--sf-font', `'${s.font || 'Inter'}', system-ui, sans-serif`);
    set('--sf-heading-font', `'${s.headingFont || s.font || 'Inter'}', Georgia, serif`);
    const fonts = [...new Set([s.font, s.headingFont].filter(Boolean))] as string[];
    if (fonts.length) {
      const link = this.doc.createElement('link');
      link.rel = 'stylesheet';
      link.href = `https://fonts.googleapis.com/css2?${fonts.map((f) => `family=${encodeURIComponent(f)}:wght@400;600;700`).join('&')}&display=swap`;
      this.doc.head.appendChild(link);
    }
    if (s.faviconUrl) {
      const icon = this.doc.querySelector<HTMLLinkElement>('link[rel=icon]');
      if (icon) icon.href = s.faviconUrl;
    }
    this.setSeo();
    if (c.seo.googleAnalyticsId && c.theme.stage === 'PUBLISHED') this.loadAnalytics(c.seo.googleAnalyticsId);
  }

  /** PDF §12 phase 5 SEO: per-page title/description + JSON-LD */
  setSeo(title?: string, description?: string, jsonLd?: object) {
    const c = this.config();
    if (!c) return;
    this.title.setTitle(title ? `${title} | ${c.store.name}` : c.seo.title || c.store.name);
    this.meta.updateTag({ name: 'description', content: description || c.seo.description || c.store.name });
    if (c.seo.keywords) this.meta.updateTag({ name: 'keywords', content: c.seo.keywords });
    this.meta.updateTag({ property: 'og:title', content: title || c.store.name });
    this.meta.updateTag({ property: 'og:description', content: description || c.seo.description || '' });
    let canonical = this.doc.querySelector<HTMLLinkElement>('link[rel=canonical]');
    if (!canonical) { canonical = this.doc.createElement('link'); canonical.rel = 'canonical'; this.doc.head.appendChild(canonical); }
    canonical.href = `${location.protocol}//${c.store.primaryDomain}${location.port ? ':' + location.port : ''}${location.pathname}`;
    this.doc.getElementById('ms-jsonld')?.remove();
    if (jsonLd) {
      const s = this.doc.createElement('script');
      s.type = 'application/ld+json'; s.id = 'ms-jsonld'; s.text = JSON.stringify(jsonLd);
      this.doc.head.appendChild(s);
    }
  }

  private loadAnalytics(id: string) {
    if (!/^G-[A-Z0-9]+$/.test(id)) return;
    const s = this.doc.createElement('script');
    s.async = true; s.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
    this.doc.head.appendChild(s);
    (window as any).dataLayer = (window as any).dataLayer || [];
    (window as any).gtag = function () { (window as any).dataLayer.push(arguments); };
    (window as any).gtag('js', new Date()); (window as any).gtag('config', id);
  }
}
