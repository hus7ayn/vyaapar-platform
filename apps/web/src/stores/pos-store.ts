import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface CartItem {
  itemId: string;
  name: string;
  sku: string;
  barcode?: string;
  hsnCode?: string;
  unit?: string;
  stockQty?: number;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
}

export interface SplitPayment {
  method: string;
  amount: number;
}

/**
 * A held bill's money fields exactly as the API stored them.
 *
 * `discountAmount` is the API's bill discount, and computeTotals() always writes it TAX-INCLUSIVE
 * (it is subtracted from subtotal + tax, and when a percentage was sent it is literally
 * (subtotal + tax) x pct/100). The POS's own flat discount is ₹-off-the-SUBTOTAL, so the two are
 * not the same number and the stored one can never be dropped straight back into the POS field —
 * loadFromHeld() converts between them.
 */
export interface HeldBillTotals {
  discountAmount?: number;
  subtotal?: number;
  taxAmount?: number;
}

interface PosState {
  cart: CartItem[];
  discountPercent: number;
  secondaryDiscountAmount: number;
  removeTax: boolean;
  roundOff: boolean;
  additionalCharges: number;
  pointsRedeemed: number;
  customerId?: string;
  splitPayments: SplitPayment[];
  heldOrderId?: string | null;
  addItem: (item: Omit<CartItem, 'quantity' | 'discount'> & { quantity?: number }) => void;
  updateQuantity: (itemId: string, quantity: number) => void;
  updatePrice: (itemId: string, price: number) => void;
  updateLineDiscount: (itemId: string, discount: number) => void;
  removeItem: (itemId: string) => void;
  setDiscountPercent: (percent: number) => void;
  setSecondaryDiscountAmount: (amount: number) => void;
  setRemoveTax: (remove: boolean) => void;
  setRoundOff: (round: boolean) => void;
  setAdditionalCharges: (amount: number) => void;
  setPointsRedeemed: (points: number) => void;
  setCustomer: (id?: string) => void;
  setSplitPayments: (payments: SplitPayment[]) => void;
  loadFromHeld: (items: CartItem[], totals?: HeldBillTotals, heldOrderId?: string | null) => void;
  clearCart: () => void;
  getLineTotal: (item: CartItem) => number;
  getSubtotal: () => number;
  getBillDiscount: () => number;
  getTaxableAmount: () => number;
  getTax: () => number;
  getCgst: () => number;
  getSgst: () => number;
  getRoundOffAmount: () => number;
  getTotal: () => number;
  getTotalQty: () => number;
}

function lineSubtotal(item: CartItem) {
  return Math.max(0, item.unitPrice * item.quantity - item.discount);
}

function lineTax(item: CartItem) {
  return (lineSubtotal(item) * item.taxRate) / 100;
}

export const usePosStore = create<PosState>()(
  persist(
    (set, get) => ({
      cart: [],
      discountPercent: 0,
      secondaryDiscountAmount: 0,
      removeTax: false,
      roundOff: true,
      additionalCharges: 0,
      pointsRedeemed: 0,
      splitPayments: [],
      heldOrderId: null,

      addItem: (item) => {
        const cart = get().cart;
        const existing = cart.find((c) => c.itemId === item.itemId);
        if (existing) {
          set({
            cart: cart.map((c) =>
              c.itemId === item.itemId
                ? { ...c, quantity: c.quantity + (item.quantity ?? 1) }
                : c,
            ),
          });
        } else {
          set({
            cart: [
              ...cart,
              { ...item, quantity: item.quantity ?? 1, discount: 0 },
            ],
          });
        }
      },

      updateQuantity: (itemId, quantity) => {
        if (quantity <= 0) {
          get().removeItem(itemId);
          return;
        }
        set({ cart: get().cart.map((c) => (c.itemId === itemId ? { ...c, quantity } : c)) });
      },

      updatePrice: (itemId, price) => {
        set({ cart: get().cart.map((c) => (c.itemId === itemId ? { ...c, unitPrice: price } : c)) });
      },

      updateLineDiscount: (itemId, discount) => {
        set({ cart: get().cart.map((c) => (c.itemId === itemId ? { ...c, discount } : c)) });
      },

      removeItem: (itemId) => {
        set({ cart: get().cart.filter((c) => c.itemId !== itemId) });
      },

      // Only the two RAW inputs are state. The rupee discount they add up to is derived on every
      // read (getBillDiscount) instead of being cached at the moment of typing — a cached figure
      // goes stale the instant a line is added, removed, repriced or re-quantified, and then the
      // screen total and the server total disagree (too high -> hard 400 "Paid amount exceeds
      // total", too low -> the bill silently books PARTIAL with a phantom receivable).
      setDiscountPercent: (percent) => set({ discountPercent: percent }),
      setSecondaryDiscountAmount: (amount) => set({ secondaryDiscountAmount: amount }),

      setRemoveTax: (remove) => set({ removeTax: remove }),
      setRoundOff: (round) => set({ roundOff: round }),
      setAdditionalCharges: (amount) => set({ additionalCharges: amount }),
      setPointsRedeemed: (points) => set({ pointsRedeemed: points }),
      setCustomer: (id) => set({ customerId: id, pointsRedeemed: 0 }),
      setSplitPayments: (payments) => set({ splitPayments: payments }),

      loadFromHeld: (items, totals = {}, heldOrderId = null) => {
        const subtotal = totals.subtotal ?? items.reduce((s, i) => s + lineSubtotal(i), 0);
        const taxAmount = totals.taxAmount ?? items.reduce((s, i) => s + lineTax(i), 0);
        const gross = subtotal + taxAmount;
        const storedDiscount = Math.max(0, totals.discountAmount ?? 0);

        // Undo the API's tax-inclusive framing so a hold -> resume -> hold round-trip is a no-op.
        // The API stores (subtotal + tax) x pct/100; the POS wants ₹ off the subtotal, which is
        // that same discount scaled by subtotal/(subtotal + tax). Re-importing the stored figure
        // as-is inflated the discount by the tax factor on EVERY cycle (₹100 -> ₹118 -> ₹139 at
        // 18% GST), so the bill got cheaper each time it was parked and picked up again.
        const secondary =
          storedDiscount > 0 && gross > 0
            ? Math.min(subtotal, (subtotal * storedDiscount) / gross)
            : 0;

        set({
          cart: items,
          discountPercent: 0,
          secondaryDiscountAmount: secondary,
          removeTax: false,
          roundOff: true,
          additionalCharges: 0,
          pointsRedeemed: 0,
          customerId: undefined,
          splitPayments: [],
          heldOrderId,
        });
      },

      clearCart: () =>
        set({
          cart: [],
          discountPercent: 0,
          secondaryDiscountAmount: 0,
          removeTax: false,
          roundOff: true,
          additionalCharges: 0,
          pointsRedeemed: 0,
          customerId: undefined,
          splitPayments: [],
          heldOrderId: null,
        }),

      getLineTotal: (item) => {
        const base = lineSubtotal(item);
        if (get().removeTax) return base;
        return base + (base * item.taxRate) / 100;
      },

      getSubtotal: () => get().cart.reduce((sum, item) => sum + lineSubtotal(item), 0),

      /**
       * The bill-level discount in rupees, ALWAYS against the current subtotal. Derived, never
       * stored, so it can never drift out of step with the cart. Capped at the goods value: the
       * taxable amount floors at zero here and the same discount reaches the API as a percentage
       * of the subtotal, which may not exceed 100%.
       */
      getBillDiscount: () => {
        const { discountPercent, secondaryDiscountAmount } = get();
        const subtotal = get().getSubtotal();
        const percent = Math.min(100, Math.max(0, discountPercent));
        const flat = Math.max(0, secondaryDiscountAmount);
        return Math.min(subtotal, (subtotal * percent) / 100 + flat);
      },

      getTaxableAmount: () => Math.max(0, get().getSubtotal() - get().getBillDiscount()),

      getTax: () => {
        if (get().removeTax) return 0;
        const sub = get().getSubtotal();
        const billDisc = get().getBillDiscount();
        return get().cart.reduce((sum, item) => {
          const line = lineSubtotal(item);
          const share = sub > 0 ? (line / sub) * billDisc : 0;
          const taxable = Math.max(0, line - share);
          return sum + (taxable * item.taxRate) / 100;
        }, 0);
      },

      getCgst: () => get().getTax() / 2,
      getSgst: () => get().getTax() / 2,

      getRoundOffAmount: () => {
        if (!get().roundOff) return 0;
        const raw =
          get().getTaxableAmount() +
          get().getTax() +
          get().additionalCharges -
          get().pointsRedeemed;
        return Math.round(raw) - raw;
      },

      getTotal: () => {
        const raw =
          get().getTaxableAmount() +
          get().getTax() +
          get().additionalCharges -
          get().pointsRedeemed;
        return get().roundOff ? Math.round(raw) : Math.max(0, raw);
      },

      getTotalQty: () => get().cart.reduce((s, i) => s + i.quantity, 0),
    }),
    {
      name: 'nexus-pos-cart',
      // discountAmount is no longer state, but it is still WRITTEN so a cart parked by this build
      // still rehydrates correctly in an older one. Reading it back is unnecessary: the discount
      // is re-derived from discountPercent / secondaryDiscountAmount, which older builds persisted
      // too and which reproduce the old cached figure exactly.
      partialize: (s) => ({
        cart: s.cart,
        discountAmount: s.getBillDiscount(),
        discountPercent: s.discountPercent,
        secondaryDiscountAmount: s.secondaryDiscountAmount,
        removeTax: s.removeTax,
        roundOff: s.roundOff,
        additionalCharges: s.additionalCharges,
        pointsRedeemed: s.pointsRedeemed,
        customerId: s.customerId,
        heldOrderId: s.heldOrderId,
      }),
    },
  ),
);
