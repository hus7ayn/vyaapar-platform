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
 * `discountAmount` is the API's bill discount and it is always TAX-INCLUSIVE: computeTotals()
 * subtracts it from (subtotal + tax). The POS's own flat discount is ₹-off-the-SUBTOTAL, so the
 * two are not the same number and the stored one can never be dropped straight back into the POS
 * field — loadFromHeld() converts between them.
 */
export interface HeldBillTotals {
  discountAmount?: number;
  subtotal?: number;
  taxAmount?: number;
}

/* ────────────────────────────────────────────────────────────────────────────────────────────
 * EXACT DECIMAL ARITHMETIC
 *
 * Why this exists: the API recomputes every bill in exact decimal (Prisma.Decimal / decimal.js)
 * and then compares the tendered amount against its own total with NO epsilon —
 * `paidAmount.gt(total)` is a hard 400 "Paid amount exceeds total", and a paise short silently
 * books the bill PARTIAL with a phantom receivable. IEEE-754 doubles cannot reproduce that
 * arithmetic: 99×5% + 3×99×12% is 40.590000000000003 in binary floating point but exactly 40.59
 * in decimal, so the screen and the server disagreed on roughly one bill in ten with Round Off
 * switched off.
 *
 * Every figure the POS shows, and every figure it posts, is now produced by the routines below,
 * which mirror the server's steps digit for digit:
 *   line taxable = unitPrice × qty − lineDiscount        (exact multiply, no rounding)
 *   line tax     = taxable × taxRate ÷ 100               (÷100 is a scale shift, exact)
 *   raw          = Σtaxable + Σtax − billDiscount + charges
 *   total        = raw rounded to 0 dp, HALF AWAY FROM ZERO   (= Decimal.toDecimalPlaces(0))
 *
 * A Dec is `u / 10^s` held in BigInt, so nothing can round on its own.
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

interface Dec {
  u: bigint;
  s: number;
}

// `0n` literals are unavailable at this tsconfig target (ES2017), so the constants are built once.
const B0 = BigInt(0);
const B2 = BigInt(2);
const B10 = BigInt(10);

const POW10: bigint[] = [];
function p10(n: number): bigint {
  return (POW10[n] ??= B10 ** BigInt(n));
}

const ZERO: Dec = { u: B0, s: 0 };

/** The exact decimal a JS number denotes — the same string `new Prisma.Decimal(n)` parses. */
function dec(n: number | undefined | null): Dec {
  if (n == null || !Number.isFinite(n)) return ZERO;
  return decFromString(n.toString());
}

function decFromString(input: string): Dec {
  let str = input.trim();
  let exp = 0;
  const e = str.search(/[eE]/);
  if (e >= 0) {
    exp = parseInt(str.slice(e + 1), 10) || 0;
    str = str.slice(0, e);
  }
  let sign = BigInt(1);
  if (str[0] === '-') {
    sign = BigInt(-1);
    str = str.slice(1);
  } else if (str[0] === '+') {
    str = str.slice(1);
  }
  let scale = 0;
  const dot = str.indexOf('.');
  if (dot >= 0) {
    scale = str.length - dot - 1;
    str = str.slice(0, dot) + str.slice(dot + 1);
  }
  scale -= exp;
  let u = sign * BigInt(str === '' ? '0' : str);
  if (scale < 0) {
    u *= p10(-scale);
    scale = 0;
  }
  return { u, s: scale };
}

const at = (d: Dec, s: number) => d.u * p10(s - d.s);
const add = (a: Dec, b: Dec): Dec => {
  const s = Math.max(a.s, b.s);
  return { u: at(a, s) + at(b, s), s };
};
const sub = (a: Dec, b: Dec): Dec => {
  const s = Math.max(a.s, b.s);
  return { u: at(a, s) - at(b, s), s };
};
const mul = (a: Dec, b: Dec): Dec => ({ u: a.u * b.u, s: a.s + b.s });
/** Divide by a power of ten — exact, it only moves the decimal point. */
const shift = (d: Dec, places: number): Dec => ({ u: d.u, s: d.s + places });
const cmp = (a: Dec, b: Dec): number => {
  const s = Math.max(a.s, b.s);
  const x = at(a, s);
  const y = at(b, s);
  return x < y ? -1 : x > y ? 1 : 0;
};
const minDec = (a: Dec, b: Dec) => (cmp(a, b) <= 0 ? a : b);
const isPos = (d: Dec) => d.u > B0;

/** Round to `places`, HALF AWAY FROM ZERO — identical to Decimal.toDecimalPlaces()'s default. */
function roundTo(d: Dec, places: number): Dec {
  if (d.s <= places) return { u: at(d, places), s: places };
  const div = p10(d.s - places);
  const neg = d.u < B0;
  const a = neg ? -d.u : d.u;
  const q = (B2 * a + div) / (B2 * div);
  return { u: neg ? -q : q, s: places };
}

/** Truncate towards zero — used wherever a figure must never be rounded UP past a cap. */
function floorTo(d: Dec, places: number): Dec {
  if (d.s <= places) return { u: at(d, places), s: places };
  const div = p10(d.s - places);
  const neg = d.u < B0;
  const a = neg ? -d.u : d.u;
  const q = a / div;
  return { u: neg ? -q : q, s: places };
}

/** round((a × b) ÷ c, places), half away from zero, with no intermediate float. c must be > 0. */
function mulDivRound(a: Dec, b: Dec, c: Dec, places: number): Dec {
  if (c.u <= B0) return ZERO;
  const n = a.u * b.u * p10(c.s + places);
  const d = c.u * p10(a.s + b.s);
  const neg = n < B0;
  const abs = neg ? -n : n;
  const q = (B2 * abs + d) / (B2 * d);
  return { u: neg ? -q : q, s: places };
}

function decToString(d: Dec): string {
  const neg = d.u < B0;
  const digits = (neg ? -d.u : d.u).toString();
  if (d.s === 0) return (neg ? '-' : '') + digits;
  const padded = digits.padStart(d.s + 1, '0');
  const cut = padded.length - d.s;
  return `${neg ? '-' : ''}${padded.slice(0, cut)}.${padded.slice(cut)}`;
}

const toNum = (d: Dec): number => Number(decToString(d));

/** True when the double carries the decimal back to the server unchanged (`new Decimal(n)`). */
const roundTrips = (n: number, d: Dec) => cmp(dec(n), d) === 0;

/* ── Exported money helpers (used by the POS page to keep payment amounts exact) ── */

/** Σ of money amounts with no binary-float drift (200 + 35.988 must not become 235.98800000000003). */
export function sumMoney(values: number[]): number {
  return toNum(values.reduce((s, v) => add(s, dec(v)), ZERO));
}

/** a − b, exactly. */
export function diffMoney(a: number, b: number): number {
  return toNum(sub(dec(a), dec(b)));
}

/**
 * The line discount as it will reach the API: quantised to paise (TxnLine.discountAmount is
 * numeric(14,2)) and never more than the line is worth.
 *
 * The cap is the point: the POS floors a line at zero, buildLines() does NOT
 * (`taxable = gross.sub(discount)` goes negative and drags the whole bill's subtotal and tax down
 * with it), so an over-typed line discount used to make the screen total exceed the server total
 * by the entire overshoot plus its tax, and the sale was rejected with nothing on screen to
 * explain why. Derived on every read rather than clamped on input, so it cannot go stale when the
 * quantity or the price moves under a discount that was legal when it was typed.
 */
export function lineDiscountOf(item: Pick<CartItem, 'unitPrice' | 'quantity' | 'discount'>): number {
  const gross = mul(dec(item.unitPrice), dec(item.quantity));
  const typed = roundTo(dec(Math.max(0, item.discount || 0)), 2);
  return toNum(minDec(typed, floorTo(gross, 2)));
}

const lineTaxable = (item: CartItem): Dec =>
  sub(mul(dec(item.unitPrice), dec(item.quantity)), dec(lineDiscountOf(item)));

const lineTaxOf = (item: CartItem, removeTax: boolean): Dec =>
  removeTax ? ZERO : shift(mul(lineTaxable(item), dec(item.taxRate)), 2);

/* ── The whole bill, in one exact pass ── */

interface BillMath {
  subtotal: Dec;
  taxTotal: Dec;
  /** Tax-inclusive bill discount — the figure POSTed as `discountAmount` and stored by the API. */
  discountIncl: Dec;
  /** The part of it that comes off the goods — what the POS shows as "Discount". */
  discountGoods: Dec;
  taxable: Dec;
  tax: Dec;
  raw: Dec;
  roundOffAmt: Dec;
  total: Dec;
}

interface BillInputs {
  cart: CartItem[];
  discountPercent: number;
  secondaryDiscountAmount: number;
  removeTax: boolean;
  roundOff: boolean;
  additionalCharges: number;
  pointsRedeemed: number;
}

function computeBill(s: BillInputs): BillMath {
  let subtotal = ZERO;
  let taxTotal = ZERO;
  for (const item of s.cart) {
    subtotal = add(subtotal, lineTaxable(item));
    taxTotal = add(taxTotal, lineTaxOf(item, s.removeTax));
  }
  const gross = add(subtotal, taxTotal);

  // What the cashier asked for: ₹ off the GOODS (both modes funnel through one figure).
  const pct = Math.min(100, Math.max(0, s.discountPercent || 0));
  const flat = roundTo(dec(Math.max(0, s.secondaryDiscountAmount || 0)), 2);
  const intent = minDec(subtotal, add(shift(mul(subtotal, dec(pct)), 2), flat));

  // The API can only express a bill discount against (subtotal + tax), so convert once, quantise
  // to paise, and treat THAT figure as authoritative on both sides. It is posted verbatim as
  // `discountAmount` (never as a percentage: numeric(5,2) cannot even hold 0.3846…%, and the
  // server re-deriving it in Decimal from a double landed a hair either side of the client's
  // pre-round total, which is how a ₹2,719.50 bill became 2720 on screen and 2719 on the server).
  // Capped at the gross, NOT at the rounded gross: when the cashier gives the whole bill away the
  // quantised figure can land a fraction of a paisa ABOVE (subtotal + tax) — the API answers that
  // with a flat 400 "Total cannot be negative" and the bill cannot be rung up at all.
  const discountIncl = isPos(intent) && isPos(subtotal)
    ? minDec(mulDivRound(intent, gross, subtotal, 2), gross)
    : ZERO;
  // Split the (rounded) discount between goods and tax so the screen's own rows still foot:
  // taxable + tax is exactly subtotal + tax − discountIncl, i.e. exactly the server's pre-round raw.
  const discountTax = isPos(discountIncl) && isPos(taxTotal) ? mulDivRound(discountIncl, taxTotal, gross, 2) : ZERO;
  const discountGoods = sub(discountIncl, discountTax);

  const taxable = sub(subtotal, discountGoods);
  const tax = sub(taxTotal, discountTax);
  const charges = roundTo(dec(Math.max(0, s.additionalCharges || 0)), 2);
  const points = roundTo(dec(Math.max(0, s.pointsRedeemed || 0)), 2);

  const raw = sub(add(add(taxable, tax), charges), points);
  const rounded = roundTo(raw, 0);
  const total = s.roundOff ? rounded : raw;

  return {
    subtotal,
    taxTotal,
    discountIncl,
    discountGoods,
    taxable,
    tax,
    raw,
    roundOffAmt: s.roundOff ? sub(rounded, raw) : ZERO,
    total: total.u < B0 ? ZERO : total,
  };
}

/** Half the tax, to the paisa. CGST gets it, SGST gets the remainder, so the two always sum to tax. */
const halfOfTax = (tax: Dec): Dec => roundTo(shift(mul(tax, dec(5)), 1), 2);

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
  getBillDiscountInclusive: () => number;
  getTaxableAmount: () => number;
  getTax: () => number;
  getCgst: () => number;
  getSgst: () => number;
  getRoundOffAmount: () => number;
  getTotal: () => number;
  getTenderAmount: () => number;
  getTotalQty: () => number;
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
      setDiscountPercent: (percent) => set({ discountPercent: Math.min(100, Math.max(0, percent || 0)) }),
      // Quantised to paise on the way in: a cashier can only give whole paise off, and a 2-dp
      // figure is what makes hold -> resume -> hold land back on exactly the same number.
      setSecondaryDiscountAmount: (amount) =>
        set({ secondaryDiscountAmount: toNum(roundTo(dec(Math.max(0, amount || 0)), 2)) }),

      setRemoveTax: (remove) => set({ removeTax: remove }),
      setRoundOff: (round) => set({ roundOff: round }),
      // Posted verbatim as an additional charge and stored in numeric(14,2) — keep it to paise so
      // the figure the bill computes with is the figure the bill stores.
      setAdditionalCharges: (amount) =>
        set({ additionalCharges: toNum(roundTo(dec(Math.max(0, amount || 0)), 2)) }),
      setPointsRedeemed: (points) => set({ pointsRedeemed: points }),
      setCustomer: (id) => set({ customerId: id, pointsRedeemed: 0 }),
      setSplitPayments: (payments) => set({ splitPayments: payments }),

      loadFromHeld: (items, totals = {}, heldOrderId = null) => {
        // Recompute the held bill's subtotal and tax from its own lines rather than trusting the
        // stored 2-dp columns: the API computed the discount against the FULL-precision figures
        // (a 12% line tax on ₹1,250.50 is 150.06, but 5% is 62.525), so inverting against the
        // rounded columns can land a paisa off.
        const hasLines = items.length > 0;
        let subtotal = ZERO;
        let taxTotal = ZERO;
        if (hasLines) {
          for (const item of items) {
            subtotal = add(subtotal, lineTaxable(item));
            taxTotal = add(taxTotal, lineTaxOf(item, false));
          }
        } else {
          subtotal = dec(totals.subtotal ?? 0);
          taxTotal = dec(totals.taxAmount ?? 0);
        }
        const gross = add(subtotal, taxTotal);
        const stored = roundTo(dec(Math.max(0, totals.discountAmount ?? 0)), 2);

        // Undo the API's tax-inclusive framing so a hold -> resume -> hold round-trip is a no-op.
        // The API's discount comes off (subtotal + tax); the POS wants ₹ off the subtotal, which is
        // that same discount scaled by subtotal/(subtotal + tax). Re-importing the stored figure
        // as-is inflated the discount by the tax factor on EVERY cycle (₹100 -> ₹118 -> ₹139 at
        // 18% GST), so the bill got cheaper each time it was parked and picked up again. Rounded
        // to paise because it is going straight into the cashier's Discount box — the unrounded
        // double rendered as "76.99706744868035" in a number input.
        const secondary =
          isPos(stored) && isPos(gross)
            ? minDec(mulDivRound(stored, subtotal, gross, 2), floorTo(subtotal, 2))
            : ZERO;

        set({
          cart: items,
          discountPercent: 0,
          secondaryDiscountAmount: toNum(secondary),
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

      getLineTotal: (item) => toNum(add(lineTaxable(item), lineTaxOf(item, get().removeTax))),

      getSubtotal: () => toNum(computeBill(get()).subtotal),

      /**
       * The bill-level discount in rupees as the POS frames it — ₹ off the goods, against the
       * CURRENT subtotal. Derived, never stored, so it can never drift out of step with the cart.
       * Capped at the goods value so the taxable amount can never go negative.
       */
      getBillDiscount: () => toNum(computeBill(get()).discountGoods),

      /**
       * The same discount as the API stores it and as the printed bill and the discount report
       * show it: tax-inclusive, because computeTotals() takes it off (subtotal + tax). ₹100 off
       * 18% goods is recorded as ₹118. Exposed so the screen can show the cashier the figure the
       * customer's receipt will carry instead of quietly disagreeing with it.
       */
      getBillDiscountInclusive: () => toNum(computeBill(get()).discountIncl),

      getTaxableAmount: () => toNum(computeBill(get()).taxable),

      getTax: () => toNum(computeBill(get()).tax),

      // Split so the two halves always add back up to the tax exactly (an odd paisa of tax used to
      // render as two halves that summed to one paisa more than the tax row above them).
      getCgst: () => toNum(halfOfTax(computeBill(get()).tax)),
      getSgst: () => {
        const tax = computeBill(get()).tax;
        return toNum(sub(tax, halfOfTax(tax)));
      },

      getRoundOffAmount: () => toNum(computeBill(get()).roundOffAmt),

      getTotal: () => toNum(computeBill(get()).total),

      /**
       * The amount to TENDER. It is the exact total the API will recompute, expressed as the
       * double that parses back to the identical decimal — so paidAmount equals total to the last
       * digit and the bill books PAID. With Round Off on, that is a whole rupee; with it off the
       * total legitimately keeps its sub-paisa tail (₹99 + 3 × ₹99 at 5%/12% is exactly ₹436.59,
       * but ₹333.33 at 5% makes it ₹453.9465) and tendering the rounded ₹453.95 was a hard 400.
       * In the (unreachable in retail) case where the decimal is too long for a double to carry
       * back unchanged, fall back to the paise BELOW it — never above, since above is rejected.
       */
      getTenderAmount: () => {
        const total = computeBill(get()).total;
        const n = toNum(total);
        return roundTrips(n, total) ? n : toNum(floorTo(total, 2));
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
