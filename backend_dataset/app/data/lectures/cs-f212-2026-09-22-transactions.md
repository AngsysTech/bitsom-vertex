---
courseCode: CS F212
date: 2026-09-22
unit: Transactions and concurrency
lecturer: Dr. Esha Kulkarni
connectorId: lms_moodle
---

Okay so today we are staying with transactions, and I want you to think less about memorising a definition and more about why a database needs the guarantees. Imagine two students paying the same fee invoice at nearly the same moment. If the system lets half of one update and half of another update survive, the numbers can look valid while the state is wrong. That is why we start with ACID properties. Atomicity means the transaction is all or nothing. Consistency means the transaction takes the database from one valid state to another valid state, assuming the transaction logic itself is correct. Isolation is about concurrent work behaving as if transactions were separated appropriately. Durability means that once a committed result is acknowledged, a crash should not casually erase it.

Now, student question — is isolation saying only one person can use the database at a time? No. Definitely not. If we did that, the system would be safe but useless. We want concurrency, but we want concurrency that has a result we can reason about. So we introduce schedules. A serial schedule runs one transaction completely and then another. A concurrent schedule interleaves operations. What matters is whether the concurrent schedule is equivalent, in the relevant sense, to some serial order.

That takes us to Serializability. For conflict serializability, you look at conflicting operations on the same data item where at least one is a write. You can build a precedence graph. Each transaction becomes a node, and the order of conflicting operations gives you directed edges. If the graph has a cycle, the schedule is not conflict serializable. If it is acyclic, a topological order gives you an equivalent serial order. This part on serializability will definitely be on the end-sem, I'm telling you now. Do not just learn the word; practise drawing the graph from a schedule because that is where people lose marks.

Let me do the lock intuition before we finish. Locking basics are simple at first: a shared lock permits compatible readers, while an exclusive lock protects a write from competing reads or writes that would violate the intended isolation. The lock manager keeps track of who holds what. If a transaction cannot get a lock immediately, it may have to wait. This is where concurrency control becomes an engineering problem, not only a definition.

A student asked whether locks automatically guarantee a correct schedule. The careful answer is that locks are a mechanism; the protocol that governs acquisition and release determines the guarantee. Today I only want the basic mental model. Read, write, conflict, wait, proceed. We will use examples next time and compare legal and illegal interleavings.

Also, notice the connection between isolation and anomalies. If you read data while another transaction is halfway through changing it, you can observe something the application never intended to expose. If you overwrite a value based on a stale read, one update can disappear. So when you see an anomaly question, translate it back to which operations were allowed to interleave and what order would make sense.

we'll come back to deadlocks next week. For now, after class, take one schedule with three transactions and try the precedence graph yourself. If you cannot decide where an edge comes from, write the pair of conflicting operations next to the edge. That little habit makes your reasoning much easier to debug. Okay, that is enough for today; next session we will make the locking story more formal and connect it to the anomalies you have already seen.
