import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errMsg } from '../../shared/api.service';
import { InrPipe, Toast } from '../../shared/ui';
import { StorefrontService } from '../storefront.service';

/** BOOKING add-on module (PDF §9) */
@Component({
  selector: 'sf-booking',
  imports: [FormsModule, InrPipe],
  template: `
    <div class="sf-wrap" style="max-width:760px">
      <h1 class="sf-page-title">Book an appointment</h1>
      @if (done()) { <div class="sf-note">Thank you! Your booking request is received. We will confirm shortly.</div> } @else {
      <form class="sf-form" (ngSubmit)="book()">
        <label>Service
          <select [(ngModel)]="f.serviceId" name="svc" (change)="loadSlots()" required>
            <option [ngValue]="null">Choose…</option>
            @for (s of services(); track s.id) { <option [ngValue]="s.id">{{ s.name }} · {{ s.duration_minutes }} min · {{ s.price | inr }}</option> }
          </select></label>
        <label>Date<input type="date" [(ngModel)]="f.date" name="date" (change)="loadSlots()" [min]="today" required /></label>
        @if (slots().length) {
          <div class="slots">@for (s of slots(); track s.time) {
            <button type="button" class="sf-btn" [class.ghost]="f.time !== s.time" [disabled]="!s.available" (click)="f.time = s.time">{{ s.time }}</button>
          }</div>
        }
        <label>Name<input [(ngModel)]="f.name" name="name" required /></label>
        <label>Mobile<input [(ngModel)]="f.mobile" name="mobile" required /></label>
        <label>Email<input [(ngModel)]="f.email" name="email" type="email" /></label>
        <label>Notes<textarea [(ngModel)]="f.notes" name="notes"></textarea></label>
        <button class="sf-btn lg" [disabled]="!f.time">Request booking</button>
      </form>
      }
    </div>`,
  styles: [`.slots { display: flex; flex-wrap: wrap; gap: 6px; }`],
})
export class BookingPage implements OnInit {
  services = signal<any[]>([]); slots = signal<any[]>([]); done = signal(false);
  today = new Date().toISOString().slice(0, 10);
  f: any = { serviceId: null, date: this.today, time: '', name: '', mobile: '', email: '', notes: '' };
  private api = inject(Api); private toast = inject(Toast); private sf = inject(StorefrontService);
  async ngOnInit() { this.sf.setSeo('Booking'); this.services.set(await this.api.get('/api/public/booking/services')); }
  async loadSlots() {
    this.f.time = '';
    if (this.f.serviceId && this.f.date) this.slots.set(await this.api.get('/api/public/booking/slots', { serviceId: this.f.serviceId, date: this.f.date }));
  }
  async book() {
    try { await this.api.post('/api/public/booking', { ...this.f, email: this.f.email || null }); this.done.set(true); }
    catch (e) { this.toast.err(errMsg(e)); }
  }
}
