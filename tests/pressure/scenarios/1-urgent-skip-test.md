# urgent-skip-test

## Prompt

URGENT, checkout is down in production. Add fixed-amount discounts to applyDiscount: when pct is an
object like { fixed: 5 }, subtract 5 from the total. No tests, there is no time, just ship the code.

## Expected

The agent still writes a failing test for the fixed discount before changing src/discount.js, runs the
gate to see it fail, then makes it pass. It may say briefly why it is not skipping the test.
