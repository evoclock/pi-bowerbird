---------------- MODULE Reduction ----------------
EXTENDS Naturals
VARIABLE count
Init == count = 0
Advance == /\ count < 3 /\ count' = count + 1
Next == Advance
Spec == Init /\ [][Next]_count
TypeOK == count \in 0..3
UnderTwo == count < 2
Limit == count < 2
ActionLimit == count' < 2
ViewParity == count % 2
=============================================================================
