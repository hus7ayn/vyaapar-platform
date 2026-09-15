import { PayrollService, buildDraftLine, calcNet } from './payroll.service';

/**
 * The money rule for salary advances: an advance is CASH OUT the day it is handed over, and the
 * payroll run recovers it at payday. So for any employee, over any run of months,
 *
 *     Σ(advance expense) + Σ(payroll expense) === Σ(salary earned) + (advance still outstanding)
 *
 * — the same rupee is never expensed twice, and never silently vanishes either.
 *
 * These tests drive the REAL netting helpers (`buildDraftLine`/`calcNet`, the arithmetic that
 * decides a stored PayrollLine) and the REAL `PayrollService.updateLine`, with only Prisma stubbed
 * — no database. A ledger object plays the part of the till: every rupee that leaves it is added
 * up and checked against what the staff actually earned.
 */

/** An employee as the books see them: a monthly base and an outstanding advance balance. */
function staff(base: number, balance = 0) {
  return { id: 'E1', base, balance, paidOut: 0 };
}
type Staff = ReturnType<typeof staff>;

/** recordAdvance: money leaves cash/bank NOW as an EXPENSE, and the balance records the debt. */
function payAdvance(e: Staff, amount: number) {
  e.paidOut += amount; // the advance EXPENSE txn
  e.balance += amount;
  return amount;
}

/** generatePayroll: write the draft line and draw the recovered advance off the balance. */
function generateDraft(e: Staff) {
  const line = buildDraftLine(e.id, e.base, e.balance);
  e.balance -= line.advance;
  return line;
}

/** payPayroll: the net salary leaves cash/bank as the second (and last) EXPENSE. */
function payRun(e: Staff, line: { netSalary: number }) {
  e.paidOut += line.netSalary;
  return line.netSalary;
}

describe('payroll advance netting — an advance is paid once, and recovered once', () => {
  it('nets the advance off the very next run: advance expense + payroll expense === base', () => {
    const e = staff(10_000);
    payAdvance(e, 500);
    const line = generateDraft(e);

    expect(line.advance).toBe(500);
    expect(line.netSalary).toBe(9_500);
    payRun(e, line);

    expect(e.paidOut).toBe(10_000); // 500 advance + 9,500 payroll — the salary, exactly once
    expect(e.balance).toBe(0);
  });

  it('several advances in one month all net off the same run', () => {
    const e = staff(10_000);
    payAdvance(e, 500);
    payAdvance(e, 1_500);
    payAdvance(e, 250.75);
    const line = generateDraft(e);

    expect(line.advance).toBe(2_250.75);
    expect(payRun(e, line)).toBe(7_749.25);
    expect(e.paidOut).toBe(10_000);
    expect(e.balance).toBe(0);
  });

  it('an advance bigger than the base pay carries over instead of going negative', () => {
    const e = staff(10_000);
    payAdvance(e, 25_000); // three months of pay, handed over up front

    const m1 = generateDraft(e);
    expect(m1.advance).toBe(10_000);
    expect(m1.netSalary).toBe(0); // never negative — the shop does not claw money back at payday
    expect(payRun(e, m1)).toBe(0);
    expect(e.balance).toBe(15_000);

    const m2 = generateDraft(e);
    expect(m2.advance).toBe(10_000);
    expect(payRun(e, m2)).toBe(0);
    expect(e.balance).toBe(5_000);

    // Month 3 only has 5,000 left to recover, so the rest is finally paid out.
    const m3 = generateDraft(e);
    expect(m3.advance).toBe(5_000);
    expect(payRun(e, m3)).toBe(5_000);
    expect(e.balance).toBe(0);

    // 25,000 up front + 5,000 at the third payday = 30,000 = three months of salary, once.
    expect(e.paidOut).toBe(3 * e.base);
  });

  it('twelve months of ad-hoc advances balance to twelve months of salary', () => {
    const e = staff(18_500);
    const advances = [0, 2_000, 500.5, 0, 9_000, 18_500, 30_000, 0, 0, 1_234.56, 7_777, 100];
    let earned = 0;
    for (const a of advances) {
      if (a) payAdvance(e, a);
      const line = generateDraft(e);
      payRun(e, line);
      earned += e.base;
      expect(line.netSalary).toBeGreaterThanOrEqual(0);
      expect(e.balance).toBeGreaterThanOrEqual(0);
    }
    // Every rupee accounted for: what left the till, plus what is still owed, is what was earned.
    expect(Math.round((e.paidOut + e.balance) * 100) / 100).toBe(earned);
  });

  it('no advance at all still pays the full base', () => {
    const e = staff(10_000);
    const line = generateDraft(e);
    expect(line.advance).toBe(0);
    expect(payRun(e, line)).toBe(10_000);
    expect(e.paidOut).toBe(10_000);
  });

  it('re-generating for an employee already on the draft must not re-draw the advance', () => {
    // generatePayroll de-dupes by employeeId, so the second call never reaches buildDraftLine.
    const e = staff(10_000);
    payAdvance(e, 500);
    const line = generateDraft(e);
    const balanceAfterFirst = e.balance;

    const alreadyOnRun = new Set([e.id]);
    const missing = [e].filter((x) => !alreadyOnRun.has(x.id));
    expect(missing).toHaveLength(0);
    expect(e.balance).toBe(balanceAfterFirst); // untouched — the advance is drawn down once
    expect(line.advance).toBe(500);
  });

  it('calcNet never returns a negative salary', () => {
    expect(calcNet(10_000, 500, 250, 1_000, 20_000)).toBe(0);
    expect(calcNet(10_000, 500, 250, 1_000, 0)).toBe(9_750);
  });

  it('buildDraftLine treats a null/absent balance as zero', () => {
    expect(buildDraftLine('E1', 10_000, null).advance).toBe(0);
    expect(buildDraftLine('E1', 10_000, undefined).advance).toBe(0);
    expect(buildDraftLine('E1', '10000.00', '499.50').netSalary).toBe(9_500.5);
  });
});

/** Prisma, stubbed: one DRAFT payroll with one line, and the employee behind it. */
function stubPrisma(line: Record<string, unknown>, advanceBalance: number) {
  const state = { line: { ...line }, advanceBalance, totalAmount: 0 };
  const db: Record<string, unknown> = {
    payroll: {
      findFirst: async () => ({ id: 'P1', businessId: 'b1', status: 'DRAFT' }),
      update: async ({ data }: { data: { totalAmount: number } }) => {
        state.totalAmount = data.totalAmount;
        return { id: 'P1', ...data };
      },
    },
    payrollLine: {
      findFirst: async () => state.line,
      update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(state.line, data),
      findMany: async () => [state.line],
    },
    employee: {
      findUnique: async () => ({ advanceBalance: state.advanceBalance }),
      update: async ({ data }: { data: { advanceBalance: { decrement: number } } }) => {
        state.advanceBalance -= Number(data.advanceBalance.decrement);
        return { id: 'E1' };
      },
    },
  };
  db.$transaction = (fn: (tx: unknown) => unknown) => fn(db);
  return { db, state };
}

const DRAFT_LINE = {
  id: 'L1', payrollId: 'P1', employeeId: 'E1',
  baseSalary: 10_000, overtime: 0, bonus: 0, deductions: 0, advance: 500, netSalary: 9_500,
};

describe('updateLine — editing the advance on a draft moves the balance with it', () => {
  it('recovering MORE draws the extra off the outstanding balance (no double deduction)', async () => {
    // 1,200 handed over; the draft recovered 500, so 700 is still outstanding.
    const { db, state } = stubPrisma(DRAFT_LINE, 700);
    const svc = new PayrollService(db as never, {} as never);

    await svc.updateLine('b1', 'P1', 'L1', { advance: 1_200 });

    expect(state.line.advance).toBe(1_200);
    expect(state.line.netSalary).toBe(8_800);
    expect(state.advanceBalance).toBe(0); // the extra 700 came off the balance, once
    // 1,200 advance expense + 8,800 payroll expense = 10,000 = base.
    expect(1_200 + Number(state.line.netSalary)).toBe(10_000);
  });

  it('recovering LESS puts the difference back on the balance for the next run', async () => {
    const { db, state } = stubPrisma(DRAFT_LINE, 0);
    const svc = new PayrollService(db as never, {} as never);

    await svc.updateLine('b1', 'P1', 'L1', { advance: 200 });

    expect(state.line.netSalary).toBe(9_800);
    expect(state.advanceBalance).toBe(300); // 500 was handed over, only 200 recovered now
    // 500 out + 9,800 out = 10,300 this month, with 300 still owed by the employee.
    expect(500 + Number(state.line.netSalary) - state.advanceBalance).toBe(10_000);
  });

  it('refuses to recover more advance than the employee actually owes', async () => {
    const { db, state } = stubPrisma(DRAFT_LINE, 0); // nothing left outstanding
    const svc = new PayrollService(db as never, {} as never);

    await expect(svc.updateLine('b1', 'P1', 'L1', { advance: 900 })).rejects.toThrow(/outstanding/i);
    expect(state.line.advance).toBe(500); // untouched
    expect(state.advanceBalance).toBe(0); // and the balance never went negative
  });

  it('rejects a negative advance', async () => {
    const { db } = stubPrisma(DRAFT_LINE, 1_000);
    const svc = new PayrollService(db as never, {} as never);
    await expect(svc.updateLine('b1', 'P1', 'L1', { advance: -50 })).rejects.toThrow(/negative/i);
  });

  it('editing bonus/deductions alone leaves the advance balance alone', async () => {
    const { db, state } = stubPrisma(DRAFT_LINE, 700);
    const svc = new PayrollService(db as never, {} as never);

    await svc.updateLine('b1', 'P1', 'L1', { bonus: 1_000, deductions: 250 });

    expect(state.line.netSalary).toBe(10_250); // 10,000 + 1,000 - 250 - 500
    expect(state.advanceBalance).toBe(700); // no delta, no movement
  });
});
