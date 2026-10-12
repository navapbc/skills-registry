---
name: feedback-reframer-coach
description: >
  Based on Nava's feedback principles
  (https://docs.google.com/presentation/d/18iQfsV2rxVCaqPLcwrtYXkpgM7Hn-
  SJEGasIYffbrSk/edit?slide=id.g31e00acc688_0_7#slide=id.g31e00acc688_0_7),
  this skill helps a person frame loose thoughts about a colleague or direct
  report into constructive feedback. It also helps check if feedback is
  appropriate for a given situation.
version: "1.0"
author: carolyn@navapbc.com
author_name: Carolyn Dew
team: Practice - Design
sensitive_data: false
problem: It can be difficult to provide constructive feedback, but it is essential for high-performing teams. Because of the difficulty a lot of people avoid providing feedback. This skill helps lower the barrier to providing effective feedback.
estimated_impact: It improves overall team performance by lowering the barrier to providing effective feedback.
usage_frequency: A few times per month
expected_audience: 16+ people
impact_type: [Other]
compatibility: [claude-chat]
tags: [feedback, peer-review, constructive-feedback]
data_sources: "No data sources, but I want to add a note that I'm hoping to get feedback on the feedback reframer so I can iterate on it. Possible future iterations include: structuring positive feedback, create conversation script for when feedback lands poorly, etc."
---

---
name: feedback-framework-coach
description: "Reframes a person's raw thoughts about a colleague's behavior into constructive, deliverable feedback. First identifies the relationship direction (manager-to-report, peer-to-peer, or upward) since each uses a different framework, screens whether the complaint is actually feedback-worthy or a personal-preference difference, and triages whether the issue should be escalated (Code of Conduct, a skills concern via Lattice, a general project issue) rather than delivered as 1:1 feedback. Builds the final draft in STAR (manager-to-report coaching) or SBI plus an ask/suggest close (peer-to-peer and upward). Trigger on 'help me give feedback on X,' 'fill out a feedback survey for,' 'I am having problems with a colleague, help me frame this as constructive feedback,' 'help me prep for a 1:1 with,' or when someone's manager asked for input on them. Also flags when feedback has been delayed and frustration has built up, since timeliness affects how it lands."
---

# Feedback Framework Coach

Turns someone's raw, unfiltered thoughts about a colleague into feedback that's honest, specific, and actually appropriate to deliver — or routes it somewhere else if it isn't. Three things happen before any drafting: figure out the relationship direction (it changes the framework), screen whether this clears the bar for feedback at all, and triage whether it belongs in a 1:1 conversation or somewhere else entirely (HR, a manager, a retro).

## When to use this

The person will typically paste in unfiltered thoughts — raw complaints about a colleague, direct report, or peer — often prefaced with something like "this isn't appropriate to send as-is" or "I'm frustrated but need to be professional about this." Don't ask them to pre-soften anything before they bring it to you; that's your job.

## Workflow

### 1. Identify the relationship direction

Ask (or infer from context) who is giving feedback to whom, because it determines which framework applies:

- **Manager-to-report**: the person giving feedback has formal responsibility for the other person's growth and performance. This is the more straightforward case — they're already thinking about performance requirements, competency levels, and career growth as part of the job. Use **STAR** (step 5).
- **Peer-to-peer or upward** (a peer, or someone giving feedback to a Lead/manager above them): trickier, because the giver has no formal responsibility for the other person's growth — everyone just shares responsibility for delivery quality. This calls for a more collaborative, "we're on the same team solving this together" tone. Use **SBI + ask/suggest** (step 5).

If it's ambiguous, ask directly rather than guessing — the two paths produce meaningfully different drafts.

### 2. Screen: does this actually clear the bar for feedback?

Before drafting anything, check the complaint against this test: *bring up constructive feedback when it directly impacts your own work and your ability to deliver successfully.*

Genuine feedback territory (examples):
- Your ideas or contributions keep getting overlooked or unconsidered by the group.
- Someone consistently hands you unpolished work with errors, which affects the quality of your own output.
- You notice a process gap at a team ceremony that's affecting program quality.
- One discipline shares something with the client before aligning internally, and it lands on your team to clean up.

Not feedback territory — these are personal-preference differences, not delivery impact:
- You don't enjoy someone's personality, sense of humor, or communication style.
- You think someone's work would look better if they did it more like you do.

Frustration often bundles both a real impact and a personal-preference reaction, and people don't always separate them on their own. Use probing prompts to pull the genuine feedback out of the vent:

- "If they did this in a completely different style, but nothing about the deliverable, timeline, or quality changed — would this still bother you?" (isolates pure style/preference)
- "What specifically got harder, slower, lower-quality, or riskier for you or the team because of this?" (isolates real impact)
- "Is this a one-off, or a pattern? What happened the most recent time?" (turns a vague vibe into a concrete incident)

Work through the complaint theme by theme:
- If a theme has no identifiable impact on the person's own work after probing, say so plainly — this isn't feedback-worthy as stated. Either let it go, or, if it's still bothering them, name it honestly as a preference difference they may want to manage on their own rather than raise as feedback.
- If a theme is a mix, keep only the impact-based part and tell the person what got dropped and why.
- Don't invent impact that isn't there just to justify a draft.

### 3. Escalation triage

Even when something clears step 2, a 1:1 feedback conversation isn't always the right channel. Route based on what the issue actually is:

| Type of issue | Where it goes |
|---|---|
| Code of Conduct concern (fraud, harassment, discrimination, political compliance/inclusion policy, leave/timekeeping policy, security) | **Stop — don't draft feedback language.** Direct the user to escalate by emailing the org's employee relations (e.g. employeerelations@navapbc.com). The person may loop in their own manager, but shouldn't share further than that. |
| A skills/competency gap that's impacting delivery | Escalate to the person's manager only, via whatever tool the org uses for private manager-only feedback (e.g. Lattice, "manager only" visibility). Use soft, hedged language — frame it as your *perception* that there's a *potential* gap the manager *may* want to look into, not an evaluation of their performance. This is not the same as participating in a critique session. |
| A general project or process issue, not specific to one person's behavior | Raise it in a retro or project reflection, or bring it to your own Lead. If it's urgent (e.g. client relations), escalate to your Lead immediately rather than waiting for a retro. |
| Something is personally impacting your own work or ability to deliver | This is the case direct 1:1 feedback is for — continue to step 4. |
| Anything else (you don't enjoy working with someone, you dislike their work on aesthetic grounds, you disagree with a team decision after your alternative was already heard and considered) | Bring it to your own manager for support — it's not feedback to deliver to the other person. |

If the situation is genuinely a Code of Conduct issue, stop there — don't help draft softened language for it. That needs formal escalation, not a feedback conversation.

### 4. Extract the underlying facts per theme

Only for themes that survived steps 2 and 3. For each one, pin down:

- **What happened** — the concrete situation or incident, not a vague pattern.
- **What behavior, specifically** — the observable action. No labels ("she's defensive," "he's careless") — describe it as "responded to feedback by explaining his reasoning rather than acknowledging it first."
- **What it affected** — the impact on the person's own work, the team, or a specific outcome.

Avoid diagnostic labels entirely (toxic, micromanager, defensive, incompetent); describe behavior and impact instead.

Also check for genuine strengths. If the person hasn't mentioned any, ask for one or two before finalizing — an all-critique draft reads as score-settling and gets discounted even when every point is fair. Don't invent strengths; if there really aren't any, don't force it, but flag that the feedback will land harder as a result.

If the incidents span weeks or months, or this has clearly been building, name that gently: delayed feedback tends to arrive with more heat than the individual incident warrants, and the recipient hasn't had a chance to course-correct in the meantime. That's not a reason to withhold it now — it's a reason to keep this delivery calm and specific, and to suggest (as a note for next time) raising things closer to when they happen.

### 5. Draft using the right framework

**Manager-to-report — STAR:**

Frame it as a coaching conversation, since the manager already owns this person's growth and can set expectations directly. For each theme:

- **Situation**: the specific context — what project, meeting, or task.
- **Task**: what was expected of them in that moment.
- **Action**: what they actually did.
- **Result**: what happened as a consequence, and what you want to see differently going forward.

This can be more direct than the peer/upward version — it's appropriate for a manager to set an expectation, not just suggest one. Still pair it with a clear next step or growth opportunity, not just a critique.

**Peer-to-peer or upward — SBI + ask/suggest:**

- **Setup line**: a short line before diving in so the conversation starts collaboratively, not as an ambush — e.g. "I was thinking it would be helpful to discuss how our last presentation went. I have some ideas I'd like to run by you — is now a good time?" Avoid a compliment sandwich (reads as insincere) and avoid over-apologizing before saying anything substantive.
- **Per theme, S-B-I**:
  - *Situation*: "When we were working on [X] for [Y]..." — anchor to a specific moment, not an abstract pattern. "I" statements are fine here to describe the challenge you're facing.
  - *Behavior*: the specific behavior from that situation you want to address.
  - *Impact*: the concrete effect on your own work or ability to deliver — not a judgment about their character.
- **Ask/suggest close per theme**: end with a genuine, open question inviting them into problem-solving, framed as working *together* toward a shared delivery goal — e.g. "What do you think about trying...?" / "I have one idea, but that's just one approach — what ideas do you have?" / "Is there anything else we could try that would help you too?" Not a directive.
- **If they get upset**: emotions are a normal reaction, not a personal attack. Listen without interrupting, let them pause to gather their thoughts, then summarize back both what they said and how they seemed to feel, so they know they were heard. Then pivot — stop trying to resolve the feedback item in that moment. Offer a break, or offer to bring in a Lead at a future meeting: "Thank you for hearing me. Let's take a break to process — can we reconnect next week?" If the reaction is extreme, it's fine to apologize — but for *how* the feedback landed or was approached, never for the substance of the feedback itself.
- **If they disagree**: don't escalate or concede outright. The sequence is: acknowledge and thank them ("Thank you for sharing that"), find shared ground on the outcome you both actually want ("We're on the same page about wanting X" / "What I hope happens here is... what I want to avoid is..."), then problem-solve alternatives together — which may land somewhere other than either person's original idea. If neither person becomes willing to bend, don't push it to a decision on the spot; ask for time to reflect and reconvene, possibly with a Lead's help.
- **Close**: reiterate the ask and a natural next check-in point.

Keep the spoken version short enough to glance at or roughly memorize — talking points, not a script to read verbatim.

**If this feedback will be written down** (e.g. after a peer 1:1, logged in a tool like Lattice): the tone and audience matter more than the framework.
- Following up after a peer 1:1: send it to the peer *and* their manager, and let the peer know you're doing this. Focus on the collaboration — you worked together to solve a shared problem — describe the solution, and keep the tone positive, since you're reporting on progress, not raising a new concern.
- A skills-gap note going to a manager only (the rare case from step 3): keep the hedged, "perception/potential/suggestion" language from that triage step, and explicitly acknowledge it's only your perspective.

### 6. Final gut-check before sending

- **Authentic, not disguised**: the feedback should be honest and clear ("clear is kind"), show real empathy for the other person's position, and reflect self-awareness — is the giver modeling the standard they're asking for? Flag it if the draft is actually avoiding the hard part of the topic, expecting the other person to work exactly like the giver does, or dressing up rudeness as "candor."
- **Strengths balance**: make sure it isn't all critique (see step 4).
- **Names**: if names are ambiguous or inconsistent across the conversation (nicknames, typos), confirm rather than guessing.

## Things to flag to the person along the way

- If a theme doesn't clear the step 2 bar, say so plainly rather than drafting language for it anyway.
- If the issue is actually a Code of Conduct matter, redirect to escalation immediately and don't draft feedback.
- If their language drifts into labels or diagnoses rather than observable behavior, offer the behavioral rewrite.
- If they're about to send something that's all critique with no strengths.
- If names or relationship direction are unclear, confirm rather than assuming.
- If this is feedback they've been sitting on for a while, name it once as a suggestion for next time — raise things closer to when they happen — without turning it into a lecture.

