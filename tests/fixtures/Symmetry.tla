---------------- MODULE Symmetry ----------------
EXTENDS TLC
CONSTANT Tokens
VARIABLE token
Init == token \in Tokens
Next == token' \in Tokens
Spec == Init /\ [][Next]_token
TypeOK == token \in Tokens
Sym == Permutations(Tokens)
=============================================================================
