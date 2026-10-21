import { Component, OnInit, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../../shared/api.service';
import { InrPipe } from '../../shared/ui';
import { CartService } from '../cart.service';
import { StorefrontService } from '../storefront.service';

@Component({
  selector: 'sf-cart',
  imports: [RouterLink, InrPipe],
  template: `
    <div class="sf-wrap">
      <h1 class="sf-page-title">Your cart</h1>
      @if (!cart.lines().length) {
        <p>Your cart is empty.</p><a class="sf-btn" routerLink="/products">Continue shopping</a>
      } @else {
        <div class="sf-two">
          <table class="sf-table">
            @for (l of cart.lines(); track l.productId) {
              <tr>
                <td style="width:72px">@if (l.image) { <img [src]="l.image" style="width:64px;height:72px;object-fit:cover;border-radius:var(--sf-radius)" [alt]="l.name" /> }</td>
                <td><a [routerLink]="['/product', l.slug]">{{ l.name }}</a><br /><small>{{ l.price | inr }}</small></td>
                <td><div class="sf-qty"><button (click)="cart.setQty(l.productId, l.quantity - 1)">−</button><span>{{ l.quantity }}</span><button (click)="cart.setQty(l.productId, l.quantity + 1)">+</button></div></td>
                <td style="text-align:right"><b>{{ l.price * l.quantity | inr }}</b><br /><button class="linkish" (click)="cart.remove(l.productId)">Remove</button></td>
              </tr>
            }
          </table>
          <div class="sf-card">
            <div class="line"><span>Subtotal</span><b>{{ cart.subtotal() | inr }}</b></div>
            <div class="line"><span>Shipping</span><b>{{ shipping() === 0 ? 'FREE' : (shipping() | inr) }}</b></div>
            @if (co().freeShippingAbove && cart.subtotal() < co().freeShippingAbove!) { <small>Add {{ co().freeShippingAbove! - cart.subtotal() | inr }} more for free shipping</small> }
            @if (cart.subtotal() < co().minOrderAmount) { <p class="warn">Minimum order is {{ co().minOrderAmount | inr }}</p> }
            <a class="sf-btn lg" style="width:100%;margin-top:14px" routerLink="/checkout" [class.disabled]="cart.subtotal() < co().minOrderAmount">Checkout</a>
          </div>
        </div>
      }
    </div>`,
  styles: [`.line { display: flex; justify-content: space-between; margin-bottom: 8px; } .linkish { background: none; border: 0; color: inherit; opacity: .6; cursor: pointer; font-size: 12px; }
    .warn { color: #c2410c; } .disabled { pointer-events: none; opacity: .5; }`],
})
export class CartPage implements OnInit {
  cart = inject(CartService); private api = inject(Api); private sf = inject(StorefrontService);
  co = computed(() => this.sf.config()!.checkout);
  shipping = computed(() => this.co().freeShippingAbove != null && this.cart.subtotal() >= this.co().freeShippingAbove! ? 0 : this.co().shippingFlatFee);
  async ngOnInit() {
    this.sf.setSeo('Cart');
    if (this.cart.lines().length) {
      const rows = await this.api.post('/api/public/cart/price', { items: this.cart.lines().map((l) => ({ productId: l.productId, quantity: l.quantity })) });
      this.cart.sync(rows);
    }
  }
}
