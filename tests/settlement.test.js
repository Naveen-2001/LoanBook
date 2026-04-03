const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  getRateForMonth,
  getPrincipalForMonth,
  calculateMonthlyDues,
  buildPaidMap,
  settle,
  recalculateAllSettlements,
  getLoanStatus,
  generateSettlementSummary,
} = require('../services/settlement');

const { getMonthRange, compareMonths, getNextMonth } = require('../utils/monthHelpers');

function withMockedNow(isoString, fn) {
  const RealDate = Date;
  class MockDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) {
        super(isoString);
      } else {
        super(...args);
      }
    }
    static now() {
      return new RealDate(isoString).getTime();
    }
  }
  global.Date = MockDate;
  try {
    return fn();
  } finally {
    global.Date = RealDate;
  }
}

// ─── Helper: basic loan ───
const baseLoan = {
  principal: 300000,
  ratePerMonth: 2,
  startDate: '2025-01',
  dateGiven: null,
  paymentFrequency: 1,
  oldDue: 0,
  rateHistory: [],
  principalRepayments: [],
};

// ─── monthHelpers tests ───
describe('monthHelpers', () => {
  it('getMonthRange returns correct range', () => {
    const range = getMonthRange('2025-01', '2025-04');
    assert.deepStrictEqual(range, ['2025-01', '2025-02', '2025-03', '2025-04']);
  });

  it('getMonthRange handles year boundary', () => {
    const range = getMonthRange('2025-11', '2026-02');
    assert.deepStrictEqual(range, ['2025-11', '2025-12', '2026-01', '2026-02']);
  });

  it('getMonthRange single month', () => {
    const range = getMonthRange('2025-06', '2025-06');
    assert.deepStrictEqual(range, ['2025-06']);
  });

  it('compareMonths works correctly', () => {
    assert.ok(compareMonths('2025-01', '2025-02') < 0);
    assert.ok(compareMonths('2025-12', '2025-01') > 0);
    assert.ok(compareMonths('2025-06', '2025-06') === 0);
    assert.ok(compareMonths('2024-12', '2025-01') < 0);
  });

  it('getNextMonth handles normal and year boundary cases', () => {
    assert.strictEqual(getNextMonth('2025-01'), '2025-02');
    assert.strictEqual(getNextMonth('2025-12'), '2026-01');
  });
});

// ─── getRateForMonth ───
describe('getRateForMonth', () => {
  it('returns base rate when no history', () => {
    assert.strictEqual(getRateForMonth(baseLoan, '2025-06'), 2);
  });

  it('returns changed rate after effective date', () => {
    const loan = {
      ...baseLoan,
      rateHistory: [{ rate: 1.5, effectiveFrom: '2025-06' }],
    };
    assert.strictEqual(getRateForMonth(loan, '2025-05'), 2);
    assert.strictEqual(getRateForMonth(loan, '2025-06'), 1.5);
    assert.strictEqual(getRateForMonth(loan, '2025-09'), 1.5);
  });

  it('handles multiple rate changes', () => {
    const loan = {
      ...baseLoan,
      rateHistory: [
        { rate: 1.5, effectiveFrom: '2025-04' },
        { rate: 1.0, effectiveFrom: '2025-08' },
      ],
    };
    assert.strictEqual(getRateForMonth(loan, '2025-01'), 2);
    assert.strictEqual(getRateForMonth(loan, '2025-04'), 1.5);
    assert.strictEqual(getRateForMonth(loan, '2025-07'), 1.5);
    assert.strictEqual(getRateForMonth(loan, '2025-08'), 1.0);
    assert.strictEqual(getRateForMonth(loan, '2025-12'), 1.0);
  });
});

// ─── getPrincipalForMonth ───
describe('getPrincipalForMonth', () => {
  it('returns full principal when no repayments', () => {
    assert.strictEqual(getPrincipalForMonth(baseLoan, '2025-06'), 300000);
  });

  it('subtracts principal repayments from the same month onwards', () => {
    const loan = {
      ...baseLoan,
      principalRepayments: [{ amount: 50000, date: '2025-06-15' }],
    };
    // June repayment: affects June onwards (spec: "Dec 1 repayment → Dec onwards")
    assert.strictEqual(getPrincipalForMonth(loan, '2025-05'), 300000);
    assert.strictEqual(getPrincipalForMonth(loan, '2025-06'), 250000);
    assert.strictEqual(getPrincipalForMonth(loan, '2025-07'), 250000);
  });

  it('handles multiple repayments', () => {
    const loan = {
      ...baseLoan,
      principalRepayments: [
        { amount: 50000, date: '2025-03-01' },
        { amount: 30000, date: '2025-06-15' },
      ],
    };
    assert.strictEqual(getPrincipalForMonth(loan, '2025-02'), 300000);
    assert.strictEqual(getPrincipalForMonth(loan, '2025-03'), 250000);
    assert.strictEqual(getPrincipalForMonth(loan, '2025-06'), 220000);
    assert.strictEqual(getPrincipalForMonth(loan, '2025-07'), 220000);
  });
});

// ─── calculateMonthlyDues ───
describe('calculateMonthlyDues', () => {
  it('calculates correct dues for simple loan', () => {
    const dues = calculateMonthlyDues(baseLoan, '2025-03');
    assert.strictEqual(dues.length, 3);
    assert.deepStrictEqual(dues, [
      { month: '2025-01', due: 6000 },
      { month: '2025-02', due: 6000 },
      { month: '2025-03', due: 6000 },
    ]);
  });

  it('adjusts for rate changes', () => {
    const loan = {
      ...baseLoan,
      rateHistory: [{ rate: 1.5, effectiveFrom: '2025-03' }],
    };
    const dues = calculateMonthlyDues(loan, '2025-04');
    assert.strictEqual(dues[0].due, 6000);  // Jan: 2%
    assert.strictEqual(dues[1].due, 6000);  // Feb: 2%
    assert.strictEqual(dues[2].due, 4500);  // Mar: 1.5%
    assert.strictEqual(dues[3].due, 4500);  // Apr: 1.5%
  });

  it('adjusts for principal repayment', () => {
    const loan = {
      ...baseLoan,
      principalRepayments: [{ amount: 100000, date: '2025-03-01' }],
    };
    const dues = calculateMonthlyDues(loan, '2025-05');
    assert.strictEqual(dues[0].due, 6000);  // Jan: 300k * 2%
    assert.strictEqual(dues[1].due, 6000);  // Feb: 300k * 2%
    assert.strictEqual(dues[2].due, 4000);  // Mar: 200k * 2% (repayment in March affects March onwards)
    assert.strictEqual(dues[3].due, 4000);  // Apr: 200k * 2%
    assert.strictEqual(dues[4].due, 4000);  // May: 200k * 2%
  });

  it('returns empty for future start date', () => {
    const loan = { ...baseLoan, startDate: '2099-01' };
    const dues = calculateMonthlyDues(loan, '2025-12');
    assert.strictEqual(dues.length, 0);
  });

  it('uses borrowing date cutoff when dateGiven exists', () => {
    const loan = { ...baseLoan, startDate: '2025-01', dateGiven: '2025-01-24' };
    const duesBeforeDueDay = withMockedNow('2025-03-20T00:00:00.000Z', () => calculateMonthlyDues(loan));
    const duesAfterDueDay = withMockedNow('2025-04-25T00:00:00.000Z', () => calculateMonthlyDues(loan));
    assert.deepStrictEqual(duesBeforeDueDay.map(d => d.month), ['2025-02']);
    assert.deepStrictEqual(duesAfterDueDay.map(d => d.month), ['2025-02', '2025-03', '2025-04']);
  });

  it('counts ten due months for a May 20 loan on April 4 next year', () => {
    const loan = { ...baseLoan, startDate: '2025-05', dateGiven: '2025-05-20' };
    const dues = withMockedNow('2026-04-04T00:00:00.000Z', () => calculateMonthlyDues(loan));
    assert.strictEqual(dues.length, 10);
    assert.strictEqual(dues[0].month, '2025-06');
    assert.strictEqual(dues[9].month, '2026-03');
  });
});

// ─── buildPaidMap ───
describe('buildPaidMap', () => {
  it('builds correct paid map from settlements', () => {
    const payments = [
      {
        settlements: [
          { forMonth: '2025-01', settledAmount: 6000 },
          { forMonth: '2025-02', settledAmount: 6000 },
        ],
      },
      {
        settlements: [
          { forMonth: '2025-02', settledAmount: 0 }, // edge: zero
          { forMonth: '2025-03', settledAmount: 3000 },
        ],
      },
    ];
    const map = buildPaidMap(payments);
    assert.strictEqual(map['2025-01'], 6000);
    assert.strictEqual(map['2025-02'], 6000);
    assert.strictEqual(map['2025-03'], 3000);
  });

  it('handles empty payments', () => {
    assert.deepStrictEqual(buildPaidMap([]), {});
  });
});

// ─── settle (THE core test) ───
describe('settle', () => {
  it('spec example: ₹16,000 against 6 unpaid months', () => {
    // Jan-Sep already paid
    const existingPayments = [];
    for (let m = 1; m <= 9; m++) {
      existingPayments.push({
        settlements: [{
          forMonth: `2025-${String(m).padStart(2, '0')}`,
          settledAmount: 6000,
          dueAmount: 6000,
          isFull: true,
        }],
      });
    }

    // Unpaid: Oct, Nov, Dec 2025, Jan, Feb, Mar 2026
    const result = settle(baseLoan, existingPayments, 16000, '2026-03');

    assert.strictEqual(result.settlements.length, 3);
    assert.deepStrictEqual(result.settlements[0], {
      forMonth: '2025-10',
      dueAmount: 6000,
      settledAmount: 6000,
      isFull: true,
    });
    assert.deepStrictEqual(result.settlements[1], {
      forMonth: '2025-11',
      dueAmount: 6000,
      settledAmount: 6000,
      isFull: true,
    });
    assert.deepStrictEqual(result.settlements[2], {
      forMonth: '2025-12',
      dueAmount: 6000,
      settledAmount: 4000,
      isFull: false,
    });
    assert.strictEqual(result.excess, 0);
  });

  it('exact payment for one month', () => {
    const result = settle(baseLoan, [], 6000, '2025-01');
    assert.strictEqual(result.settlements.length, 1);
    assert.strictEqual(result.settlements[0].isFull, true);
    assert.strictEqual(result.excess, 0);
  });

  it('partial payment', () => {
    const result = settle(baseLoan, [], 4000, '2025-01');
    assert.strictEqual(result.settlements.length, 1);
    assert.strictEqual(result.settlements[0].settledAmount, 4000);
    assert.strictEqual(result.settlements[0].isFull, false);
    assert.strictEqual(result.excess, 0);
  });

  it('payment larger than all dues returns excess', () => {
    const result = settle(baseLoan, [], 20000, '2025-02');
    // 2 months × 6000 = 12000, excess = 8000
    assert.strictEqual(result.settlements.length, 2);
    assert.strictEqual(result.excess, 8000);
  });

  it('no dues to settle', () => {
    const existing = [{
      settlements: [{ forMonth: '2025-01', settledAmount: 6000 }],
    }];
    const result = settle(baseLoan, existing, 5000, '2025-01');
    assert.strictEqual(result.settlements.length, 0);
    assert.strictEqual(result.excess, 5000);
  });

  it('handles partial existing payment then new payment', () => {
    const existing = [{
      settlements: [{ forMonth: '2025-01', settledAmount: 4000 }],
    }];
    const result = settle(baseLoan, existing, 5000, '2025-02');
    // Jan remaining: 2000, Feb: 6000, total = 8000
    // Payment 5000: Jan 2000 (full), Feb 3000 (partial)
    assert.strictEqual(result.settlements.length, 2);
    assert.strictEqual(result.settlements[0].forMonth, '2025-01');
    assert.strictEqual(result.settlements[0].settledAmount, 2000);
    assert.strictEqual(result.settlements[0].isFull, true);
    assert.strictEqual(result.settlements[1].forMonth, '2025-02');
    assert.strictEqual(result.settlements[1].settledAmount, 3000);
    assert.strictEqual(result.settlements[1].isFull, false);
  });

  it('settles old due before monthly dues', () => {
    const loan = { ...baseLoan, oldDue: 5000 };
    const result = settle(loan, [], 7000, '2025-01');
    assert.strictEqual(result.settlements[0].forMonth, 'OLD_DUE');
    assert.strictEqual(result.settlements[0].settledAmount, 5000);
    assert.strictEqual(result.settlements[1].forMonth, '2025-01');
    assert.strictEqual(result.settlements[1].settledAmount, 2000);
  });
});

// ─── recalculateAllSettlements ───
describe('recalculateAllSettlements', () => {
  it('recalculates settlements in chronological order', () => {
    const payments = [
      { amount: 10000, paidDate: '2025-02-15', createdAt: '2025-02-15' },
      { amount: 5000, paidDate: '2025-03-15', createdAt: '2025-03-15' },
    ];

    const results = recalculateAllSettlements(baseLoan, payments, '2025-03');

    // First payment: 10000 → Jan 6000 (full), Feb 4000 (partial)
    assert.strictEqual(results[0].settlements.length, 2);
    assert.strictEqual(results[0].settlements[0].forMonth, '2025-01');
    assert.strictEqual(results[0].settlements[0].settledAmount, 6000);
    assert.strictEqual(results[0].settlements[1].forMonth, '2025-02');
    assert.strictEqual(results[0].settlements[1].settledAmount, 4000);

    // Second payment: 5000 → Feb remaining 2000 (full), Mar 3000 (partial)
    assert.strictEqual(results[1].settlements.length, 2);
    assert.strictEqual(results[1].settlements[0].forMonth, '2025-02');
    assert.strictEqual(results[1].settlements[0].settledAmount, 2000);
    assert.strictEqual(results[1].settlements[1].forMonth, '2025-03');
    assert.strictEqual(results[1].settlements[1].settledAmount, 3000);
  });
});

// ─── getLoanStatus ───
describe('getLoanStatus', () => {
  it('returns correct status for partially paid loan', () => {
    const payments = [
      {
        settlements: [
          { forMonth: '2025-01', settledAmount: 6000 },
          { forMonth: '2025-02', settledAmount: 6000 },
          { forMonth: '2025-03', settledAmount: 3000 },
        ],
      },
    ];

    const status = getLoanStatus(baseLoan, payments, '2025-05');

    assert.strictEqual(status.months.length, 5);
    assert.strictEqual(status.months[0].status, 'paid');
    assert.strictEqual(status.months[1].status, 'paid');
    assert.strictEqual(status.months[2].status, 'partial');
    assert.strictEqual(status.months[3].status, 'unpaid');
    assert.strictEqual(status.months[4].status, 'unpaid');

    assert.strictEqual(status.totalDue, 30000);
    assert.strictEqual(status.totalPaid, 15000);
    assert.strictEqual(status.totalPending, 15000);
    assert.strictEqual(status.pendingMonths, 3);
    assert.strictEqual(status.pendingSince, '2025-03');
    assert.strictEqual(status.outstandingPrincipal, 300000);
    assert.strictEqual(status.monthlyDue, 6000);
  });

  it('reflects principal repayments in outstanding', () => {
    const loan = {
      ...baseLoan,
      principalRepayments: [{ amount: 100000, date: '2025-03-01' }],
    };
    const status = getLoanStatus(loan, [], '2025-05');
    assert.strictEqual(status.outstandingPrincipal, 200000);
  });

  it('includes old due in total pending', () => {
    const loan = { ...baseLoan, oldDue: 5000 };
    const status = getLoanStatus(loan, [], '2025-01');
    assert.strictEqual(status.oldDueRemaining, 5000);
    assert.strictEqual(status.totalPending, 11000);
  });
});

// ─── generateSettlementSummary ───
describe('generateSettlementSummary', () => {
  it('generates readable summary', () => {
    const settlements = [
      { forMonth: '2025-10', dueAmount: 6000, settledAmount: 6000, isFull: true },
      { forMonth: '2025-11', dueAmount: 6000, settledAmount: 4000, isFull: false },
    ];
    const summary = generateSettlementSummary(settlements, 0);
    assert.ok(summary.includes('10,000'));
    assert.ok(summary.includes('fully settled'));
    assert.ok(summary.includes('partially settled'));
  });

  it('handles excess', () => {
    const summary = generateSettlementSummary([], 5000);
    assert.ok(summary.includes('excess'));
  });
});
