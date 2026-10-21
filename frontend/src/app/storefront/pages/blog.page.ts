import { Component, OnInit, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { DomSanitizer } from '@angular/platform-browser';
import { Api } from '../../shared/api.service';
import { StorefrontService } from '../storefront.service';

/** BLOG add-on module (PDF §9) */
@Component({
  selector: 'sf-blog-list',
  imports: [RouterLink, DatePipe],
  template: `
    <div class="sf-wrap">
      <h1 class="sf-page-title">Blog</h1>
      <div class="sf-grid">
        @for (p of posts(); track p.id) {
          <a class="sf-card" [routerLink]="['/blog', p.slug]">
            @if (p.cover_image_url) { <img [src]="p.cover_image_url" style="aspect-ratio:16/9;object-fit:cover;border-radius:var(--sf-radius);margin-bottom:10px" [alt]="p.title" /> }
            <h3>{{ p.title }}</h3><small>{{ p.published_at | date: 'mediumDate' }}</small><p>{{ p.excerpt }}</p>
          </a>
        } @empty { <p>No posts yet.</p> }
      </div>
      @if (cursor()) { <button class="sf-btn ghost" (click)="load()">Load more</button> }
    </div>`,
})
export class BlogListPage implements OnInit {
  posts = signal<any[]>([]); cursor = signal<string | null>(null);
  private api = inject(Api); private sf = inject(StorefrontService);
  ngOnInit() { this.sf.setSeo('Blog'); this.load(); }
  async load() {
    const r = await this.api.get('/api/public/blog', { cursor: this.cursor() ?? undefined });
    this.posts.update((l) => [...l, ...r.items]); this.cursor.set(r.nextCursor);
  }
}

@Component({
  selector: 'sf-blog-post',
  imports: [RouterLink, DatePipe],
  template: `
    @if (p(); as p) {
      <article class="sf-wrap" style="max-width:760px">
        <div class="sf-crumbs"><a routerLink="/blog">Blog</a></div>
        <h1>{{ p.title }}</h1><small>{{ p.published_at | date: 'longDate' }}</small>
        @if (p.cover_image_url) { <img [src]="p.cover_image_url" style="margin:16px 0;border-radius:var(--sf-radius)" [alt]="p.title" /> }
        <div class="sf-rich" [innerHTML]="html()"></div>
      </article>
    }`,
})
export class BlogPostPage {
  slug = input.required<string>();
  p = signal<any>(null);
  private api = inject(Api); private sf = inject(StorefrontService); private san = inject(DomSanitizer);
  html = () => this.san.bypassSecurityTrustHtml(this.p()?.content || '');
  constructor() {
    effect(() => {
      this.api.get(`/api/public/blog/${this.slug()}`).then((p) => { this.p.set(p); this.sf.setSeo(p.seo_title || p.title, p.seo_description || p.excerpt); });
    });
  }
}
