---------------- MODULE Terminal ----------------
EXTENDS Naturals
VARIABLE count
Init == count = 0
Increment == /\ count = 0 /\ count' = 1
End == /\ count = 1 /\ UNCHANGED count
Next == Increment \/ End
SpecDeadlock == Init /\ [][Increment]_count
SpecTerminal == Init /\ [][Next]_count
TypeOK == count \in 0..1
=============================================================================
