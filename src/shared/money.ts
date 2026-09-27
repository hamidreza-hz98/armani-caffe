export type Money = Readonly<{ currency: "IRT"; amountToman: number }>;

export function toman(amountToman: number): Money {
  if (!Number.isSafeInteger(amountToman) || amountToman < 0) {
    throw new RangeError("Money amount must be a non-negative safe integer in toman");
  }
  return Object.freeze({ currency: "IRT", amountToman });
}

export function addMoney(left: Money, right: Money): Money {
  return toman(left.amountToman + right.amountToman);
}

export function subtractMoney(left: Money, right: Money): Money {
  return toman(left.amountToman - right.amountToman);
}
