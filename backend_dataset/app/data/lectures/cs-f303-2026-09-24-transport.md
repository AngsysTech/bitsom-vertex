---
courseCode: CS F303
date: 2026-09-24
unit: Transport layer
lecturer: Dr. Ved Suri
connectorId: lms_moodle
---

Okay so today we are on the Transport layer, and I want to focus on what TCP is trying to provide to applications. The network underneath can lose, delay, duplicate or reorder packets. TCP gives the application a reliable byte stream, and it does that with sequence numbers, acknowledgements, retransmission logic and a connection state at both ends.

We start with the TCP three-way handshake. Suppose a client wants to connect to a server. The client sends a SYN with an initial sequence number. The server replies with SYN-ACK, acknowledging the client and providing its own initial sequence number. The client then sends the final ACK. After that, both sides have confirmed reachability and synchronized the starting sequence-number state needed for the connection. I always ask one question on the three-way handshake.

A student asked why two messages are not enough. Think about old delayed segments and the fact that each direction has state. The third message confirms that the client received the server's sequence information. In the simplified exam model, draw the client and server as two vertical lifelines and label SYN, SYN-ACK and ACK with the sequence and acknowledgement values. That picture prevents a lot of avoidable confusion.

Now flow control. Flow control is about protecting the receiver from a sender that can transmit faster than the receiving application can consume data. TCP advertises a receive window. The sender uses that information to limit how much unacknowledged data it has outstanding relative to the receiver's available buffer. So the key question is not whether the network is busy; it is whether the receiver has room.

This is a good place to separate mechanisms. Sequence numbers tell us where bytes belong. Acknowledgements tell us what has been received. Retransmission handles missing progress. The advertised window is the receiver telling the sender how much more data it can currently accept. If you mix those roles together, protocol questions become much harder than they need to be.

Let's do one mini example. Assume the receiver advertises a window of 4,000 bytes, and the sender has 1,500 bytes already sent but not yet acknowledged. In the simplified view, there is room for 2,500 more bytes before the sender reaches the advertised limit. When an acknowledgement arrives and the receiver advertises a new window, the sending allowance changes. Keep the units straight and make the byte ranges visible on paper.

Another student question: is UDP just bad TCP? No. UDP has a different contract. It does not establish the same reliable byte-stream abstraction. That lower overhead is useful when the application can tolerate loss, implement its own semantics, or values timeliness differently. Protocol choice follows application needs.

For the exam, be able to explain the handshake as a sequence and be able to reason about a small receiver-window example. Also connect the transport service back to the application: reliability is useful only because an application wants a predictable abstraction over an imperfect network.

Okay so before next class, redraw the handshake without looking at your notes, then explain each message aloud. If you can say what state each side learns at each step, you understand it. If you only remember SYN, SYN-ACK, ACK as a chant, you do not yet understand it. Next time we will continue with how TCP adapts its sending behavior under changing network conditions.
