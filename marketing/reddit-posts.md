# PrepAura — Reddit Post Templates

---

## Post 1 — r/cscareerquestions, r/leetcode

**Title:** I built a floating AI overlay for coding interviews that's invisible to screen sharing — want beta testers

I've been preparing for FAANG interviews for the past few months and got frustrated that there was no good real-time reference tool I could use during a live interview without the interviewer seeing it.

So I built one.

**PrepAura** is a small desktop app (Mac + Windows) that:
- Listens to your interview (mic + system audio) using Whisper transcription
- Streams AI answers with code examples in under 2 seconds
- Shows 5 progressive approaches per question — from basic concept → core API → patterns → advanced → gotchas
- Has a screen capture mode for HackerRank/CoderPad problems
- Is **completely invisible** to Zoom, Google Meet, HackerRank, and browser screen sharing (OS-level exclusion)

It uses Groq's free API under the hood so there's no recurring cost after you buy.

I'm offering it at **$29 one-time** via Gumroad. The first 20 buyers also get a Reddit discount — DM me.

Would love honest feedback from people in active job searches. AMA.

---

## Post 2 — r/iOSProgramming, r/swift

**Title:** Built an AI interview coach desktop app specifically tuned for iOS interviews

Hey everyone, I've been building iOS apps for a few years and recently went through the interview grind. Couldn't find any tool that gave iOS-specific answers (not generic Java/Python stuff), so I built PrepAura.

It's a floating overlay app that listens to interview questions and gives real-time answers tuned for:
- Swift / UIKit / SwiftUI / Combine / async-await
- Core Data, UserDefaults, FileManager tradeoffs
- GCD, DispatchQueue, actors, concurrency
- MVVM, Coordinator, Clean Architecture patterns
- Memory management, retain cycles, weak/unowned
- System design at iOS level (offline-first, sync, push notifications)

It's invisible to screen sharing so you can use it in live interviews. $29 one-time, Mac + Windows.

Landing page: **prepaura.gumroad.com**

Happy to add any iOS interview topics you'd find useful — drop a comment.

---

## Post 3 — r/ExperiencedDevs (softer sell)

**Title:** How do senior engineers actually answer interview questions differently? (+ tool I built to practice)

Something I noticed after doing 30+ interviews: junior answers explain what something is. Senior answers explain when to use it, why, the tradeoffs, the gotchas, and then give a concrete example.

For example, "When should you use UserDefaults vs Core Data?"
- Junior: "UserDefaults is for simple key-value storage. Core Data is for complex data."
- Senior: "UserDefaults for settings under ~1MB that you need synchronously with no query. Core Data when you need relational queries, relationships, migration, or pagination. FileManager for blobs where Core Data overhead isn't worth it. Never store PII in UserDefaults — it's not encrypted."

I built a tool called PrepAura that generates answers at the senior level — 5 progressive approaches per question with code. It's an invisible overlay (can't be seen by screen share) for use in actual interviews.

$29 at prepaura.gumroad.com if interested. But even without the tool — study the pattern of how you structure your answers.

---

## Subreddit Targets

- r/cscareerquestions (1.2M members)
- r/leetcode (400K members)
- r/ExperiencedDevs (200K members)
- r/iOSProgramming (100K members)
- r/swift (80K members)
- r/androiddev (120K members)
- r/webdev (1.2M members)
- r/learnprogramming (3M members)
- r/jobs (400K members)
- r/digitalnomad (200K members)

**Note:** Don't post all at once. Post one per day, tailor each to the subreddit's culture. Don't use the word "cheat" — use "reference tool", "AI coach", "prep assistant".
