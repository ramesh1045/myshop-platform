import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Api, errMsg } from '../../shared/api.service';
import { InrPipe, Toast, openRazorpay } from '../../shared/ui';
import { AuthStore } from '../../shared/auth';
import { CartService } from '../cart.service';
import { StorefrontService } from '../storefront.service';

/** Checkout: COD or Razorpay with the CLIENT's own keys -> money goes straight to the shop (PDF §3 step 8) */
@Component({
  selector: 'sf-checkout',
  imports: [FormsModule, InrPipe, RouterLink],
  template: `
    <div class="sf-wrap">
      <h1 class="sf-page-title">Checkout</h1>
      @if (!cart.lines().length) { <p>Your cart is empty. <a routerLink="/products">Shop now</a></p> } @else {
      <form class="sf-two" (ngSubmit)="place()">
        <div class="stack-sf">
          <div class="sf-card">
            <h3>Contact</h3>
            <div class="g2">
              <label>Full name*<input [(ngModel)]="f.customer.name" name="name" required minlength="2" /></label>
              <label>Mobile*<input [(ngModel)]="f.customer.mobile" name="mobile" required pattern="[0-9+\\- ]{10,20}" /></label>
            </div>
            <label>Email<input [(ngModel)]="f.customer.email" name="email" type="email" /></label>
            @if (!auth.customerLoggedIn()) { <small><a routerLink="/account">Login</a> to see your orders later (optional).</small> }
          </div>
          <div class="sf-card">
            <h3>Delivery address</h3>
            @if (addresses().length) {
              <select (change)="pickAddress($any($event.target).value)"><option value="">Choose a saved address…</option>
                @for (a of addresses(); track a.id) { <option [value]="a.id">{{ a.name }}, {{ a.line1 }}, {{ a.city }}</option> }</select>
            }
            <label>Address line 1*<input [(ngModel)]="f.address.line1" name="line1" required /></label>
            <label>Address line 2<input [(ngModel)]="f.address.line2" name="line2" /></label>
            <div class="g3">
              <label>City*<input [(ngModel)]="f.address.city" name="city" required /></label>
              <label>State*<input [(ngModel)]="f.address.state" name="state" required /></label>
              <label>Pincode*<input [(ngModel)]="f.address.pincode" name="pincode" required pattern="[0-9]{6}" /></label>
            </div>
            <label>Order notes<textarea [(ngModel)]="f.notes" name="notes"></textarea></label>
          </div>
          <div class="sf-card">
            <h3>Payment</h3>
            @if (co().online) { <label class="radio"><input type="radio" name="pm" value="RAZORPAY" [(ngModel)]="f.paymentMethod" /> Pay online (UPI / Card / Netbanking)</label> }
            @if (co().cod) { <label class="radio"><input type="radio" name="pm" value="COD" [(ngModel)]="f.paymentMethod" /> Cash on delivery</label> }
            @if (!co().online && !co().cod) { <p class="warn">This store is not accepting orders right now.</p> }
          </div>
        </div>
        <div class="sf-card summary">
          <h3>Order summary</h3>
          @for (l of cart.lines(); track l.productId) { <div class="line"><span>{{ l.name }} × {{ l.quantity }}</span><span>{{ l.price * l.quantity | inr }}</span></div> }
          <hr />
          @if (sf.hasModule('COUPONS')) {
            <div class="coupon"><input [(ngModel)]="couponInput" name="coupon" placeholder="Coupon code" /><button type="button" class="sf-btn ghost" (click)="applyCoupon()">Apply</button></div>
            @if (coupon()) { <div class="line ok"><span>Coupon {{ coupon()!.code }}</span><span>− {{ coupon()!.discount | inr }}</span></div> }
          }
          <div class="line"><span>Subtotal</span><span>{{ cart.subtotal() | inr }}</span></div>
          <div class="line"><span>Shipping</span><span>{{ shipping() === 0 ? 'FREE' : (shipping() | inr) }}</span></div>
          <div class="line total"><span>Total</span><b>{{ total() | inr }}</b></div>
          <small>{{ co().pricesIncludeTax ? 'Prices include GST' : 'GST will be added' }} · final amount confirmed by the store</small>
          <button class="sf-btn lg" style="width:100%;margin-top:12px" [disabled]="busy() || !f.paymentMethod">{{ busy() ? 'Placing order…' : 'Place order' }}</button>
        </div>
      </form>
      }
    </div>`,
  styles: [`
    .stack-sf { display: flex; flex-direction: column; gap: 16px; } .sf-card label { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; font-weight: 500; }
    .sf-card label.radio { flex-direction: row; align-items: center; gap: 8px; }
    .g2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; } .g3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
    .line { display: flex; justify-content: space-between; margin: 6px 0; } .total { font-size: 18px; margin-top: 10px; } .ok { color: #15803d; }
    .coupon { display: flex; gap: 8px; } .summary { align-self: start; position: sticky; top: 90px; } .warn { color: #c2410c; }
    @media (max-width: 600px) { .g2, .g3 { grid-template-columns: 1fr; } }
  `],
})
export class CheckoutPage implements OnInit {
  cart = inject(CartService); sf = inject(StorefrontService); auth = inject(AuthStore);
  private api = inject(Api); private toast = inject(Toast); private router = inject(Router);
  co = computed(() => this.sf.config()!.checkout);
  f: any = { customer: { name: '', mobile: '', email: '' }, address: { line1: '', line2: '', city: '', state: '', pincode: '' }, paymentMethod: '', notes: '' };
  couponInput = '';
  coupon = signal<{ code: string; discount: number } | null>(null);
  addresses = signal<any[]>([]);
  busy = signal(false);
  shipping = computed(() => {
    const after = this.cart.subtotal() - (this.coupon()?.discount ?? 0);
    return this.co().freeShippingAbove != null && after >= this.co().freeShippingAbove! ? 0 : this.co().shippingFlatFee;
  });
  total = computed(() => Math.round((this.cart.subtotal() - (this.coupon()?.discount ?? 0) + this.shipping()) * 100) / 100);

  async ngOnInit() {
    this.sf.setSeo('Checkout');
    this.f.paymentMethod = this.co().online ? 'RAZORPAY' : this.co().cod ? 'COD' : '';
    if (this.auth.customerLoggedIn()) {
      const [me, addr] = await Promise.all([this.api.get('/api/customer/me').catch(() => null), this.api.get('/api/customer/addresses').catch(() => [])]);
      if (me) Object.assign(this.f.customer, { name: me.name, mobile: me.mobile, email: me.email || '' });
      this.addresses.set(addr);
      const def = addr.find((a: any) => a.is_default);
      if (def) this.pickAddress(def.id);
    }
  }
  pickAddress(id: any) {
    const a = this.addresses().find((x) => String(x.id) === String(id));
    if (a) Object.assign(this.f.address, { line1: a.line1, line2: a.line2, city: a.city, state: a.state, pincode: a.pincode });
  }
  async applyCoupon() {
    if (!this.couponInput.trim()) return;
    try { this.coupon.set(await this.api.post('/api/public/coupons/apply', { code: this.couponInput, subtotal: this.cart.subtotal(), mobile: this.f.customer.mobile || undefined })); this.toast.ok('Coupon applied'); }
    catch (e) { this.coupon.set(null); this.toast.err(errMsg(e)); }
  }
  async place() {
    this.busy.set(true);
    try {
      const body = { ...this.f, customer: { ...this.f.customer, email: this.f.customer.email || null }, couponCode: this.coupon()?.code ?? null,
        items: this.cart.lines().map((l) => ({ productId: l.productId, quantity: l.quantity })) };
      const r = await this.api.post('/api/public/checkout', body);
      if (r.razorpay) {
        try {
          const pay = await openRazorpay({ key: r.razorpay.keyId, orderId: r.razorpay.razorpayOrderId, amount: r.razorpay.amount, name: this.sf.config()!.store.name,
            description: `Order ${r.orderNumber}`, prefill: { name: this.f.customer.name, email: this.f.customer.email, contact: this.f.customer.mobile },
            color: this.sf.settings().colors?.primary });
          await this.api.post('/api/public/payments/razorpay/verify', pay);
        } catch (e) {
          this.toast.err('Payment not completed. Your order is saved – you can retry or contact the store.');
        }
      }
      this.cart.clear();
      this.router.navigate(['/order', r.orderNumber], { queryParams: { m: this.f.customer.mobile } });
    } catch (e) { this.toast.err(errMsg(e)); } finally { this.busy.set(false); }
  }
}
