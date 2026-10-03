import { applyDiscount } from './discount.js'

export const cartTotal = (items, pct, taxRate) => {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0)
  return Math.round(applyDiscount(subtotal, pct) * (1 + taxRate))
}
