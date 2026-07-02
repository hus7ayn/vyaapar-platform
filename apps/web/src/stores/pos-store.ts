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

interface PosState {
  cart: CartItem[];
  discountAmount: number;
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
  setDiscount: (amount: number) => void;
  setDiscountPercent: (percent: number) => void;
  setSecondaryDiscountAmount: (amount: number) => void;
  setRemoveTax: (remove: boolean) => void;
  setRoundOff: (round: boolean) => void;
  setAdditionalCharges: (amount: number) => void;
  setPointsRedeemed: (points: number) => void;
  setCustomer: (id?: string) => void;
  setSplitPayments: (payments: SplitPayment[]) => void;
  loadFromHeld: (items: CartItem[], discountAmount?: number, heldOrderId?: string | null) => void;
  clearCart: () => void;
  getLineTotal: (item: CartItem) => number;
  getSubtotal: () => number;
  getTaxableAmount: () => number;
  getTax: () => number;
  getCgst: () => number;
  getSgst: () => number;
  getRoundOffAmount: () => number;
  getTotal: () => number;
  getTotalQty: () => number;
  recalculateDiscount: (percent: number, secondary: number) => void;
}

function lineSubtotal(item: CartItem) {
  return Math.max(0, item.unitPrice * item.quantity - item.discount);
}

export const usePosStore = create<PosState>()(
  persist(
    (set, get) => ({
      cart: [],
      discountAmount: 0,
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

      setDiscount: (amount) => set({ discountAmount: amount }),

      setDiscountPercent: (percent) => {
        set({ discountPercent: percent });
        get().recalculateDiscount(percent, get().secondaryDiscountAmount);
      },

      setSecondaryDiscountAmount: (amount) => {
        set({ secondaryDiscountAmount: amount });
        get().recalculateDiscount(get().discountPercent, amount);
      },

      recalculateDiscount: (percent, secondary) => {
        const subtotal = get().getSubtotal();
        const primaryDiscount = (subtotal * percent) / 100;
        set({ discountAmount: primaryDiscount + secondary });
      },

      setRemoveTax: (remove) => set({ removeTax: remove }),
      setRoundOff: (round) => set({ roundOff: round }),
      setAdditionalCharges: (amount) => set({ additionalCharges: amount }),
      setPointsRedeemed: (points) => set({ pointsRedeemed: points }),
      setCustomer: (id) => set({ customerId: id, pointsRedeemed: 0 }),
      setSplitPayments: (payments) => set({ splitPayments: payments }),

      loadFromHeld: (items, discountAmount = 0, heldOrderId = null) =>
        set({
          cart: items,
          discountAmount,
          discountPercent: 0,
          secondaryDiscountAmount: discountAmount,
          removeTax: false,
          roundOff: true,
          additionalCharges: 0,
          pointsRedeemed: 0,
          customerId: undefined,
          splitPayments: [],
          heldOrderId,
        }),

      clearCart: () =>
        set({
          cart: [],
          discountAmount: 0,
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

      getTaxableAmount: () => {
        const sub = get().getSubtotal();
        const billDisc = get().discountAmount;
        return Math.max(0, sub - billDisc);
      },

      getTax: () => {
        if (get().removeTax) return 0;
        const sub = get().getSubtotal();
        const billDisc = get().discountAmount;
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
      partialize: (s) => ({
        cart: s.cart,
        discountAmount: s.discountAmount,
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
