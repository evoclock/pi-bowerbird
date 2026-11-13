---------------- MODULE Temporal ----------------
EXTENDS Naturals
VARIABLE count
Init == count = 0
Next == \/ /\ count = 0 /\ count' = 1
        \/ /\ count = 1 /\ count' = 0
Spec == Init /\ [][Next]_count
FairSpec == Spec /\ WF_count(Next)
Live == <> (count = 2)
LiveLater == <> (count = 3)
EventuallyOne == <> (count = 1)
=============================================================================
