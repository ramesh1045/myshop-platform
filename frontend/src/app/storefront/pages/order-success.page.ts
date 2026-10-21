import { Component, OnInit, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../../shared/api.service';
import { InrPipe, BadgeComponent } from '../../shared/ui';
import { StorefrontService } from '../storefront.service';

@Component({
  selector: 'sf-order-success',
  imports: [RouterLink, InrPipe, BadgeComponent],
  template: `
    <div class="sf-wrap" style="max-width:640px;text-align:center;padding:40px 16px">
      <h1>Thank you! 🎉</h1>
      <p>Your order <b>{{ number() }}</b> has been placed.</p>
      @if (o(); as o) {
        <div class="sf-card" style="text-align:left">
          <p>Status: <ms-badge [value]="o.status" /> · Payment: <ms-badge [value]="o.paymentStatus" /></p>
          @for (i of o.items; track $index) { <div style="display:flex;justify-content:space-between"><span>{{ i.name }} × {{ i.quantity }}</span><span>{{ i.lineTotal | inr }}</span></div> }
          <hr /><div style="display:flex;justify-content:space-between"><b>Total</b><b>{{ o.grandTotal | inr }}</b></div>
        </div>
      }
      <p style="margin-top:20px"><a class="sf-btn" routerLink="/products">Continue shopping</a> <a class="sf-btn ghost" routerLink="/track">Track order</a></p>
    </div>`,
})
export class OrderSuccessPage implements OnInit {
  number = input.required<string>();
  m = input<string>();
  o = signal<any>(null);
  private api = inject(Api); private sf = inject(StorefrontService);
  async ngOnInit() {
    this.sf.setSeo('Order placed');
    if (this.m()) this.o.set(await this.api.post('/api/public/orders/track', { orderNumber: this.number(), mobile: this.m() }).catch(() => null));
  }
}
