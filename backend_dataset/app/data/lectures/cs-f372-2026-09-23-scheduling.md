---
courseCode: CS F372
date: 2026-09-23
unit: CPU scheduling
lecturer: Dr. Rishi Menon
connectorId: lms_moodle
---

Okay so today is CPU scheduling, and this is one of those topics where the definitions are easy but the calculation is where mistakes happen. Start with the job of the scheduler: when several ready processes could use the CPU, the operating system chooses which one runs next. We care about measures such as waiting time, turnaround time and response time, and the best policy depends on the workload and the system goal.

First, FCFS scheduling. First Come, First Served does what the name says. Processes run in arrival order. It is simple and it is easy to implement with a queue. But if a long CPU-bound process arrives just before several short processes, the short ones wait behind it. That convoy effect is why simple fairness by arrival order is not automatically good performance.

Now Shortest Job First. If you knew the next CPU burst exactly, choosing the shortest available job can minimize average waiting time for that set of jobs. The catch is obvious: in a real system, you normally do not know the exact future burst. You estimate it from past behavior. For exam problems, though, the burst times are given, so your job is to build the schedule carefully.

Let me pause for a student question: if two jobs have the same burst time, what do we do? Use the tie-breaking rule stated in the question; if nothing is stated, arrival order is the sensible convention and you should say that assumption. Never hide an assumption in a scheduling calculation.

Then Round Robin. Round Robin is preemptive. Each ready process gets up to one time quantum, and unfinished work returns to the ready queue. A very small quantum improves responsiveness but increases context-switch overhead. A very large quantum starts behaving more like FCFS. So when you draw the timeline, update the ready queue after every arrival and every quantum expiration. Expect a Gantt-chart question on Round Robin in the end-sem.

Let's do the practical workflow. Write arrival times and burst times in a small table. Mark the current clock time. Choose the process according to the rule. Draw its interval on the Gantt chart. Then update remaining burst time and add any newly arrived processes before choosing again. If you skip the queue update, your whole answer can drift even if the first two boxes are right.

Why do operating systems keep several policies instead of one perfect scheduler? Because the objective changes. Interactive systems value response. Batch workloads may care more about throughput or average turnaround. Real schedulers also account for priorities and behavior over time. Today we are keeping the models clean so you can see the trade-off directly.

One more thing: do not confuse waiting time with turnaround time. Turnaround is completion minus arrival. Waiting is turnaround minus actual CPU service time, assuming the simple model in the question. Response time is the time from arrival until the process first gets CPU service. Those are three different numbers.

For practice, take four processes with staggered arrivals and compare FCFS, Shortest Job First and Round Robin. If the answers look too similar, check whether you accidentally treated Round Robin as non-preemptive. Okay, stop there. Next class we will move from these baseline policies toward richer scheduler behavior and then connect scheduling to responsiveness in interactive systems.
