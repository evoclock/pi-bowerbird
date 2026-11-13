---------------- MODULE Counter ----------------
EXTENDS Naturals
VARIABLE count
Init == count = 0
Increment == /\ count < 2 /\ count' = count + 1
Next == Increment
Spec == Init /\ [][Next]_count
TypeOK == count \in 0..2
UnderTwo == count < 2
=============================================================================
