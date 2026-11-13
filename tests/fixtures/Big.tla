---------------- MODULE Big ----------------
EXTENDS Naturals
CONSTANT Max
VARIABLE count
Init == count = 0
Next == /\ count < Max /\ count' = count + 1
Spec == Init /\ [][Next]_count
TypeOK == count \in 0..Max
=============================================================================
