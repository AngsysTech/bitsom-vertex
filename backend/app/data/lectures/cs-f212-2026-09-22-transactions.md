---
lectureId: cs-f212-2026-09-22-transactions
courseCode: CS F212
date: 2026-09-22
title: Transactions, schedules and serializability
lecturer: Prof. R. Iyer
stub: true
---
# CS F212 Lecture 14: Transactions, schedules and serializability

Okay, good morning, let's settle down. Last week we finished indexing, so today we move into Unit 4, which is transactions and concurrency control. This is the part of the course where databases stop being just storage and start behaving like systems that many people use at the same time.

So what is a transaction? A transaction is a unit of program execution that reads and possibly updates data items. The classic example is a bank transfer: you read the balance of account A, subtract fifty, write it back, then read account B, add fifty, and write that back. Either all of those steps happen or none of them do.

That brings us to the ACID properties. Atomicity means all or nothing. Consistency means a transaction that starts from a consistent database leaves it consistent. Isolation means each transaction behaves as if it were running alone, even though others are running concurrently. Durability means once a transaction commits, its changes survive crashes. Write these four down, they come up again and again.

Now, why do we run transactions concurrently at all? Because it improves throughput and reduces waiting time. The disk can work for one transaction while the CPU works for another. But the moment we interleave operations, we need to talk about schedules.

A schedule is a sequence that shows the chronological order in which instructions of concurrent transactions are executed. A serial schedule runs one transaction completely, then the next. Serial schedules are always correct, but they are slow. So the question becomes: when is a concurrent schedule as good as some serial schedule? That idea is called serializability.

Let me be precise about conflicts. Two operations conflict if they belong to different transactions, they access the same data item, and at least one of them is a write. So read-read does not conflict, but read-write, write-read and write-write do. If I can turn a schedule into a serial schedule by swapping only non-conflicting adjacent operations, the schedule is conflict serializable.

How do you test that without swapping by hand? You draw a precedence graph. One node per transaction. You add an edge from Ti to Tj if an operation of Ti conflicts with a later operation of Tj. If the graph has a cycle, the schedule is not conflict serializable. If it is acyclic, any topological order of the graph gives you an equivalent serial schedule.

Mark my words, conflict serializability will be on the end-sem: you will be given a schedule and asked to draw its precedence graph.

Let us do one quickly on the board. T1 reads A, T2 writes A, then T2 reads B and T1 writes B. T1 reads A before T2 writes it, so there is an edge from T1 to T2. T2 reads B before T1 writes it, so there is an edge from T2 to T1. We have a cycle, so this schedule is not conflict serializable.

There is also a weaker notion called view serializability, which accepts some schedules with blind writes, but testing it is NP-complete, so in practice systems aim for conflict serializability. I will not examine you on view serializability beyond the definition.

Next, recoverability. Suppose T2 reads a value that T1 wrote, and T2 commits before T1 commits. If T1 now aborts, T2 has already committed based on a value that never officially existed. A recoverable schedule is one where, if Tj reads data written by Ti, then Ti commits before Tj commits.

Even recoverable schedules can suffer from cascading rollbacks, where one abort forces several other transactions to abort. A cascadeless schedule avoids that: a transaction only reads data that has already been committed. Every cascadeless schedule is also recoverable.

Right, we are almost out of time. Assignment 3, on testing schedules for conflict serializability, is due on Friday, October 2nd, on Moodle.

In the next lecture we will start deadlocks: wait-for graphs, detection and prevention. Before that, please read Section 18.2 of the Silberschatz textbook on deadlock handling. That's all for today, thank you.
