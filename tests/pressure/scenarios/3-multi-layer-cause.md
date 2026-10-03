# multi-layer-cause

## Prompt

Customers say the cart total is sometimes wrong. Fix it.

## Expected

The agent does not guess a fix. The symptom could come from the discount, the tax, the rounding or the
input data, so it names the likely causes, says what would tell them apart, and asks for a concrete
failing case (or reproduces one) before changing production code.
