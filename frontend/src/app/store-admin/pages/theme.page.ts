import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { Api, errMsg } from '../../shared/api.service';
import { InrPipe, Toast } from '../../shared/ui';
import { SectionEditorComponent, Section } from '../section-editor';

const FONTS = ['Inter', 'Poppins', 'Lato', 'Roboto', 'Open Sans', 'Montserrat', 'Playfair Display', 'Merriweather', 'Noto Sans Tamil', 'Mukta Malar', 'Hind Madurai'];

/**
 * Theme & branding (PDF §5.4): 1. pick theme  2. colours/font/logo/banner/radius  3. home sections (drag & drop)
 * Live preview of the DRAFT in an iframe, then Draft -> Publish. No developer needed (PDF §12 phase 3).
 */
@Component({
  selector: 'sa-theme',
  imports: [FormsModule, SectionEditorComponent, RouterLink, InrPipe, DatePipe],
  template: `
    <div class="page-head"><h1>Theme & branding</h1><span class="spacer"></span>
      <span class="muted">@if (published()) { Last published {{ published().published_at | date: 'medium' }} }</span>
      <button class="btn" (click)="discard()">Discard draft</button>
      <button class="btn" (click)="saveDraft()" [disabled]="busy()">Save draft</button>
      <button class="btn primary" (click)="publish()" [disabled]="busy()"><span class="mi">publish</span> Publish</button>
    </div>
    @if (draft(); as d) {
    <div class="grid c2" style="grid-template-columns: 420px 1fr; align-items: start">
      <div class="stack">
        <div class="card stack">
          <h3>1. Theme</h3>
          <div class="themes">
            @for (t of themes(); track t.id) {
              <button type="button" class="theme" [class.sel]="d.theme_id === t.id" (click)="pickTheme(t)">
                <b>{{ t.name }}</b>
                <small class="muted">@if (t.exclusive) { Exclusive to you } @else if (t.isPremium && !t.owned) { Premium · {{ t.price | inr }} } @else { {{ t.isPremium ? 'Owned' : 'Free' }} }</small>
              </button>
            }
          </div>
          @if (needsPurchase()) { <div class="alert warn">This premium theme must be purchased first. <a routerLink="/admin/billing">Buy in Billing</a></div> }
        </div>
        <div class="card stack">
          <h3>2. Colours, font & logo</h3>
          <div class="grid c3">
            @for (c of colorKeys; track c) { <label class="field"><span>{{ c }}</span><input type="color" [(ngModel)]="d.settings.colors[c]" (change)="dirty()" /></label> }
          </div>
          <div class="grid c2">
            <label class="field"><span>Body font</span><select [(ngModel)]="d.settings.font" (change)="dirty()">@for (f of fonts; track f) { <option>{{ f }}</option> }</select></label>
            <label class="field"><span>Heading font</span><select [(ngModel)]="d.settings.headingFont" (change)="dirty()">@for (f of fonts; track f) { <option>{{ f }}</option> }</select></label>
          </div>
          <label class="field"><span>Corner radius: {{ d.settings.borderRadius }}px</span><input type="range" min="0" max="24" [(ngModel)]="d.settings.borderRadius" (change)="dirty()" /></label>
          <label class="field"><span>Product card style</span><select [(ngModel)]="d.settings.productCardStyle" (change)="dirty()"><option value="bordered">Bordered</option><option value="minimal">Minimal</option><option value="overlay">Overlay</option></select></label>
          @for (img of imageKeys; track img.key) {
            <div class="row">
              @if (d.settings[img.key]) { <img class="thumb" [src]="d.settings[img.key]" alt="" /> }
              <label class="btn sm"><span class="mi">upload</span> {{ img.label }}<input type="file" accept="image/*" hidden (change)="upload($event, img.key)" /></label>
              @if (d.settings[img.key]) { <button class="link" (click)="d.settings[img.key] = null; dirty()">remove</button> }
            </div>
          }
        </div>
        <div class="card">
          <h3>3. Home page sections</h3>
          <p class="muted">Drag to change the order. Untick “Show” to hide a block.</p>
          <section-editor [(sections)]="sections" (sectionsChange)="dirty()" [forms]="forms()" />
        </div>
      </div>
      <div class="card preview">
        <div class="row"><b>Live preview (draft)</b><span class="spacer"></span>
          <button class="btn sm" [class.primary]="device() === 'desktop'" (click)="device.set('desktop')">Desktop</button>
          <button class="btn sm" [class.primary]="device() === 'mobile'" (click)="device.set('mobile')">Mobile</button>
          <button class="btn sm" (click)="refresh()"><span class="mi">refresh</span></button></div>
        @if (previewUrl()) { <iframe [src]="previewUrl()" [style.width]="device() === 'mobile' ? '390px' : '100%'"></iframe> }
      </div>
    </div>
    }`,
  styles: [`
    .themes { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .theme { text-align: left; border: 2px solid var(--ui-border); background: #fff; border-radius: 8px; padding: 10px; display: flex; flex-direction: column; gap: 4px; cursor: pointer; }
    .theme.sel { border-color: var(--ui-primary); }
    .preview { position: sticky; top: 12px; } .preview iframe { height: calc(100vh - 140px); border: 1px solid var(--ui-border); border-radius: 8px; margin: 10px auto 0; display: block; background: #fff; }
  `],
})
export class ThemePage implements OnInit {
  private api = inject(Api); private toast = inject(Toast); private san = inject(DomSanitizer);
  draft = signal<any>(null); published = signal<any>(null); themes = signal<any[]>([]); forms = signal<any[]>([]);
  sections: Section[] = [];
  busy = signal(false); device = signal<'desktop' | 'mobile'>('desktop');
  previewUrl = signal<SafeResourceUrl | null>(null);
  colorKeys = ['primary', 'secondary', 'accent', 'background', 'surface', 'text'];
  fonts = FONTS;
  imageKeys = [{ key: 'logoUrl', label: 'Logo' }, { key: 'bannerUrl', label: 'Banner' }, { key: 'faviconUrl', label: 'Favicon' }];
  private changed = false;
  private timer: any;
  needsPurchase = computed(() => { const t = this.themes().find((x) => x.id === this.draft()?.theme_id); return !!t && !t.owned; });

  async ngOnInit() {
    await this.load();
    this.forms.set((await this.api.get('/api/admin/forms', { size: 100 }).catch(() => ({ items: [] }))).items);
    this.refresh();
  }
  async load() {
    const r = await this.api.get('/api/admin/theme');
    r.draft.settings.colors ??= {};
    this.draft.set(r.draft); this.published.set(r.published); this.themes.set(r.themes);
    this.sections = structuredClone(r.draft.sections);
  }
  dirty() { this.changed = true; clearTimeout(this.timer); this.timer = setTimeout(() => this.saveDraft(true), 1200); }
  pickTheme(t: any) {
    if (!t.owned) { this.toast.err('Buy this premium theme in Billing first'); return; }
    this.draft.update((d) => ({ ...d, theme_id: t.id }));
    this.api.put('/api/admin/theme/draft', { themeId: t.id }).then(() => this.load()).then(() => this.refresh()).catch((e) => this.toast.err(errMsg(e)));
  }
  async upload(ev: Event, key: string) {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try { this.draft().settings[key] = (await this.api.upload('/api/admin/media', file)).url; this.dirty(); } catch (e) { this.toast.err(errMsg(e)); }
  }
  async saveDraft(silent = false) {
    clearTimeout(this.timer);
    this.busy.set(true);
    try {
      const d = this.draft();
      const r = await this.api.put('/api/admin/theme/draft', { settings: { ...d.settings, borderRadius: Number(d.settings.borderRadius) }, sections: this.sections });
      d.version = r.version; this.changed = false;
      if (!silent) this.toast.ok('Draft saved');
      this.refresh();
    } catch (e) { this.toast.err(errMsg(e)); } finally { this.busy.set(false); }
  }
  async publish() {
    if (this.changed) await this.saveDraft(true);
    try { await this.api.post('/api/admin/theme/publish'); this.toast.ok('Published! Customers now see the new design.'); this.load(); }
    catch (e) { this.toast.err(errMsg(e)); }
  }
  async discard() {
    if (!confirm('Discard all unpublished changes?')) return;
    await this.api.post('/api/admin/theme/discard-draft'); await this.load(); this.refresh();
  }
  async refresh() {
    const r = await this.api.post('/api/admin/theme/preview-token');
    const u = new URL(r.previewUrl);
    this.previewUrl.set(this.san.bypassSecurityTrustResourceUrl(`${location.origin}/${u.search}&t=${Date.now()}`));
  }
}
