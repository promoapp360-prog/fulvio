export type PricingContext = {
  size?: string | null;
  coatType?: string | null;
  coatLength?: string | null;
};

export type PricingRuleMatch = PricingContext & {
  id?: number;
  sortOrder?: number;
  active?: boolean;
};

const normalized = (value?: string | null) => (value || "").trim().toLocaleLowerCase("it-IT");

/** Seleziona la regola più specifica; i pareggi seguono l'ordine definito dall'Admin. */
export function selectServicePricingRule<T extends PricingRuleMatch>(rules: T[], context: PricingContext): T | null {
  return rules.filter((rule) =>
    rule.active !== false &&
    (!rule.size || rule.size === context.size) &&
    (!rule.coatType || normalized(rule.coatType) === normalized(context.coatType)) &&
    (!rule.coatLength || normalized(rule.coatLength) === normalized(context.coatLength))
  ).sort((a, b) => {
    const specificity = (rule: PricingRuleMatch) => Number(!!rule.size) + Number(!!rule.coatType) + Number(!!rule.coatLength);
    return specificity(b) - specificity(a) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || (a.id ?? 0) - (b.id ?? 0);
  })[0] ?? null;
}

/** Evita fasce invertite o massimi senza un minimo. */
export function isValidPriceRange(min: number | null | undefined, max: number | null | undefined): boolean {
  if (max == null) return true;
  return min != null && max >= min;
}
