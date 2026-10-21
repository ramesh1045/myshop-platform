import { Component, inject, input, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { Api } from '../shared/api.service';

export interface Section { id: string; type: string; enabled: boolean; config: Record<string, any> }

export const SECTION_LABELS: Record<string, string> = {
  HERO_BANNER: 'Hero banner', CATEGORY_GRID: 'Category grid', FEATURED_PRODUCTS: 'Featured products', NEW_ARRIVALS: 'New arrivals',
  RICH_TEXT: 'Text block', IMAGE_WITH_TEXT: 'Image with text', GALLERY: 'Gallery', TESTIMONIALS: 'Testimonials', NEWSLETTER: 'Newsletter / CTA',
  FORM: 'Form', VIDEO: 'YouTube video', SPACER: 'Spacer', BLOG_POSTS: 'Blog link', BOOKING_CTA: 'Booking button',
};

/**
 * Drag & drop section builder — used for home page sections (PDF §5.4 layer 3)
 * and page-builder pages About/Gallery/Contact (PDF §9).
 */
@Component({
  selector: 'section-editor',
  imports: [FormsModule, DragDropModule],
  template: `
    <div cdkDropList (cdkDropListDropped)="drop($event)">
      @for (s of sections(); track s.id; let i = $index) {
        <div class="drag-item sec" cdkDrag [class.off]="!s.enabled">
          <div class="row" style="width:100%">
            <span class="mi drag-handle" cdkDragHandle>drag_indicator</span>
            <b>{{ label(s.type) }}</b><span class="spacer"></span>
            <label class="check"><input type="checkbox" [(ngModel)]="s.enabled" (ngModelChange)="emit()" /> Show</label>
            <button type="button" class="btn sm" (click)="open.set(open() === s.id ? null : s.id)">{{ open() === s.id ? 'Close' : 'Edit' }}</button>
            <button type="button" class="btn sm danger" (click)="remove(i)">✕</button>
          </div>
          @if (open() === s.id) {
            <div class="stack cfg" (input)="emit()" (change)="emit()">
              @switch (s.type) {
                @case ('HERO_BANNER') {
                  <label class="field"><span>Title</span><input [(ngModel)]="s.config['title']" /></label>
                  <label class="field"><span>Subtitle</span><input [(ngModel)]="s.config['subtitle']" /></label>
                  <div class="grid c2"><label class="field"><span>Button text</span><input [(ngModel)]="s.config['ctaText']" /></label>
                    <label class="field"><span>Button link</span><input [(ngModel)]="s.config['ctaLink']" placeholder="/products" /></label></div>
                  <label class="field"><span>Background image (empty = theme banner)</span><input [(ngModel)]="s.config['imageUrl']" /></label>
                  <label class="btn sm"><span class="mi">upload</span> Upload<input type="file" accept="image/*" hidden (change)="upload($event, s, 'imageUrl')" /></label>
                }
                @case ('CATEGORY_GRID') { <label class="field"><span>Title</span><input [(ngModel)]="s.config['title']" /></label><label class="field"><span>How many</span><input type="number" [(ngModel)]="s.config['limit']" /></label> }
                @case ('FEATURED_PRODUCTS') { <label class="field"><span>Title</span><input [(ngModel)]="s.config['title']" /></label><label class="field"><span>How many</span><input type="number" [(ngModel)]="s.config['limit']" /></label> }
                @case ('NEW_ARRIVALS') { <label class="field"><span>Title</span><input [(ngModel)]="s.config['title']" /></label><label class="field"><span>How many</span><input type="number" [(ngModel)]="s.config['limit']" /></label>
                  <label class="field"><span>Only category (slug, optional)</span><input [(ngModel)]="s.config['category']" /></label> }
                @case ('RICH_TEXT') { <label class="field"><span>Content (HTML)</span><textarea rows="6" [(ngModel)]="s.config['html']"></textarea></label> }
                @case ('IMAGE_WITH_TEXT') {
                  <label class="field"><span>Title</span><input [(ngModel)]="s.config['title']" /></label>
                  <label class="field"><span>Text (HTML)</span><textarea [(ngModel)]="s.config['html']"></textarea></label>
                  <label class="field"><span>Image URL</span><input [(ngModel)]="s.config['imageUrl']" /></label>
                  <label class="btn sm"><span class="mi">upload</span> Upload<input type="file" accept="image/*" hidden (change)="upload($event, s, 'imageUrl')" /></label>
                  <label class="check"><input type="checkbox" [(ngModel)]="s.config['imageRight']" /> Image on right</label>
                }
                @case ('GALLERY') {
                  <label class="field"><span>Title</span><input [(ngModel)]="s.config['title']" /></label>
                  <div class="row">@for (img of s.config['images'] || []; track $index; let j = $index) { <div style="position:relative"><img class="thumb" [src]="img" alt="" /><button type="button" class="link" (click)="s.config['images'].splice(j, 1); emit()">✕</button></div> }</div>
                  <label class="btn sm"><span class="mi">add_photo_alternate</span> Add image<input type="file" accept="image/*" hidden (change)="upload($event, s, 'images')" /></label>
                }
                @case ('TESTIMONIALS') {
                  <label class="field"><span>Title</span><input [(ngModel)]="s.config['title']" /></label>
                  @for (t of s.config['items'] || []; track $index; let j = $index) {
                    <div class="grid c2"><input [(ngModel)]="t.name" placeholder="Name" /><input [(ngModel)]="t.text" placeholder="What they said" /></div>
                  }
                  <button type="button" class="btn sm" (click)="(s.config['items'] = s.config['items'] || []).push({ name: '', text: '' }); emit()">+ Add testimonial</button>
                }
                @case ('NEWSLETTER') { <label class="field"><span>Title</span><input [(ngModel)]="s.config['title']" /></label><label class="field"><span>Text</span><input [(ngModel)]="s.config['text']" /></label>
                  <label class="field"><span>Form</span><select [(ngModel)]="s.config['formId']"><option [ngValue]="null">— none —</option>@for (f of forms(); track f.id) { <option [ngValue]="f.id">{{ f.name }}</option> }</select></label> }
                @case ('FORM') { <label class="field"><span>Form</span><select [(ngModel)]="s.config['formId']">@for (f of forms(); track f.id) { <option [ngValue]="f.id">{{ f.name }}</option> }</select></label> }
                @case ('VIDEO') { <label class="field"><span>YouTube URL</span><input [(ngModel)]="s.config['url']" /></label> }
                @case ('SPACER') { <label class="field"><span>Height (px)</span><input type="number" [(ngModel)]="s.config['height']" /></label> }
                @default { <label class="field"><span>Title</span><input [(ngModel)]="s.config['title']" /></label> }
              }
            </div>
          }
        </div>
      }
    </div>
    <div class="row mt">
      <select [(ngModel)]="newType" style="width:auto">@for (t of types(); track t) { <option [value]="t">{{ label(t) }}</option> }</select>
      <button type="button" class="btn" (click)="add()"><span class="mi">add</span> Add section</button>
    </div>`,
  styles: [`.sec { flex-direction: column; align-items: stretch; } .sec.off { opacity: .55; } .cfg { margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--ui-border); }`],
})
export class SectionEditorComponent {
  sections = model<Section[]>([]);
  types = input<string[]>(Object.keys(SECTION_LABELS));
  forms = input<any[]>([]);
  open = signal<string | null>(null);
  newType = 'RICH_TEXT';
  private api = inject(Api);

  label(t: string) { return SECTION_LABELS[t] ?? t; }
  emit() { this.sections.set([...this.sections()]); }
  drop(e: CdkDragDrop<Section[]>) { const l = [...this.sections()]; moveItemInArray(l, e.previousIndex, e.currentIndex); this.sections.set(l); }
  add() {
    const id = `${this.newType.toLowerCase()}-${Math.random().toString(36).slice(2, 7)}`;
    const defaults: Record<string, any> = { HERO_BANNER: { title: 'Welcome', ctaText: 'Shop now', ctaLink: '/products' }, FEATURED_PRODUCTS: { title: 'Featured', limit: 8 },
      NEW_ARRIVALS: { title: 'New arrivals', limit: 8 }, CATEGORY_GRID: { title: 'Shop by category', limit: 6 }, RICH_TEXT: { html: '<p>Write something…</p>' },
      GALLERY: { images: [] }, TESTIMONIALS: { items: [] }, SPACER: { height: 40 }, FORM: { formId: this.forms()[0]?.id ?? null } };
    this.sections.set([...this.sections(), { id, type: this.newType, enabled: true, config: structuredClone(defaults[this.newType] ?? {}) }]);
    this.open.set(id);
  }
  remove(i: number) { const l = [...this.sections()]; l.splice(i, 1); this.sections.set(l); }
  async upload(ev: Event, s: Section, key: string) {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const r = await this.api.upload('/api/admin/media', file);
    if (key === 'images') (s.config['images'] = s.config['images'] || []).push(r.url); else s.config[key] = r.url;
    this.emit();
  }
}
