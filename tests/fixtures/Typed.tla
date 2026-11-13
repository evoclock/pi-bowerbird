---------------- MODULE Typed ----------------
EXTENDS Naturals, Sequences
CONSTANT Token
VARIABLES flag, index, bag, steps, data, token
vars == <<flag, index, bag, steps, data, token>>
Init == /\ flag = TRUE /\ index = 0 /\ bag = {1, 2}
        /\ steps = <<1, 2>> /\ data = [a |-> 1, b |-> FALSE] /\ token = Token
Next == UNCHANGED vars
Spec == Init /\ [][Next]_vars
TypeOK == index \in Nat
=============================================================================
