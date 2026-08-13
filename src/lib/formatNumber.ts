/**
 * The admin journal is read in French like everything else: `0.0123` and `1250 ms` were printed by
 * `toFixed` and by nothing that knows the language. A cost with a decimal point beside a quantity
 * with a comma, on the same line, is the kind of detail that makes a screen read as untranslated.
 */
const usd = new Intl.NumberFormat('fr-FR', {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
})
const integer = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 })

export function formatUsd(value: number): string {
  return `${usd.format(value)} USD`
}

export function formatMs(value: number): string {
  return `${integer.format(Math.round(value))} ms`
}

/**
 * A failure rate. Below one percent it keeps a decimal, because « 0 % » beside a non-zero count of
 * failures says the opposite of what the journal recorded.
 */
export function formatRate(rate: number): string {
  const digits = rate > 0 && rate < 0.01 ? 1 : 0
  return `${new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(rate * 100)} %`
}
