import { Component, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { Api, errMsg } from '../../shared/api.service';
import { InrPipe, BadgeComponent } from '../../shared/ui';
import { StorefrontService } from '../storefront.service';

/** Order tracking without login (PDF §4 Customer "order track") */
@Component({
  selector: 'sf-track',
  imports: [FormsModule, InrPipe, BadgeComponent, DatePipe],
  template: `
    <div class="sf-wrap" style="max-width:680px">
      <h1 class="sf-page-title">Track your order</h1>
      <form class="sf-form" (ngSubmit)="track()">
        <label>Order number<input [(ngModel)]="orderNumber" name="n" required placeholder="e.g. KAV-000123" /></label>
        <label>Mobile number used for the order<input [(ngModel)]="mobile" name="m" required /></label>
        <button class="sf-btn">Track</button>
      </form>
      @if (err()) { <p class="sf-note" style="margin-top:16px">{{ err() }}</p> }
      @if (o(); as o) {
        <div class="sf-card" style="margin-top:20px">
          <h3>{{ o.orderNumber }} <ms-badge [value]="o.status" /></h3>
          <p>Placed {{ o.placedAt | date: 'medium' }} · Total {{ o.grandTotal | inr }} · Payment <ms-badge [value]="o.paymentStatus" /></p>
          @if (o.trackingNumber) { <p>Courier: {{ o.courierName }} · Tracking no: <b>{{ o.trackingNumber }}</b></p> }
          <ul class="sf-timeline">@for (h of o.history; track $index) { <li><b>{{ h.status }}</b> · {{ h.at | date: 'medium' }}@if (h.note) { — {{ h.note }} }</li> }</ul>
        </div>
      }
    </div>`,
})
export class TrackPage implements OnInit {
  orderNumber = ''; mobile = '';
  o = signal<any>(null); err = signal('');
  private api = inject(Api); private sf = inject(StorefrontService);
  ngOnInit() { this.sf.setSeo('Track order'); }
  async track() {
    this.err.set(''); this.o.set(null);
    try { this.o.set(await this.api.post('/api/public/orders/track', { orderNumber: this.orderNumber, mobile: this.mobile })); }
    catch (e) { this.err.set(errMsg(e)); }
  }
}
