export type Money = Readonly<{ currency: "IRR"; amount: number }>;

export function rial(amount: number): Money {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new RangeError("Money amount must be a non-negative safe integer in rials");
  }
  return Object.freeze({ currency: "IRR", amount });
}

export function addMoney(left: Money, right: Money): Money {
  return rial(left.amount + right.amount);
}

export function subtractMoney(left: Money, right: Money): Money {
  return rial(left.amount - right.amount);
}
