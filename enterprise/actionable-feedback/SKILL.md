---
name: actionable-feedback
description: >
  Turns a vague "I need to say something to Alex" into a paste-ready Slack
  message or review comment. Triggered when you describe a workplace
  situation and ask for help articulating it, or just say something like
  "help me give feedback to my teammate."  The skill follows one framework:
  what happened → what you noticed → what it did. Context, observable
  behavior, concrete impact. No trait judgments ("you're not a good
  listener"), no impact fluff ("it built collaboration"). If you say "the
  stakeholders looked lost by slide three," that's good. If you say "it
  improved team dynamics," the skill will push you to get specific. If you
  give it something vague ("Alex never pulls their weight"), it won't draft
  vague feedback back at you. It'll ask you for a specific recent moment
  first, then build from there. If the impact is missing, it'll ask for that
  too.
version: "1.0"
author: joseoyola@navapbc.com
author_name: Jose Oyola-Sepulveda
team: Practice - Product Management
sensitive_data: false
problem: "In terms of time: probably 15-30 minutes saved per micro feedback instance, more for formal reviews. The bigger unlock isn't time though, it's that feedback that used to not happen at all now actually gets delivered.

Feedback that's too vague to be useful. \"Great job\" and \"you need to communicate better\" are the two failure modes. Neither changes behavior. Writing feedback that's specific, behavioral, and impact-focused is genuinely hard to do well under time pressure.

The gap between knowing something and being able to say it. Most people know when something went wrong or went right. Articulating it in a way that's fair, direct, and won't land as a personal attack is where the friction is. The skill bridges that gap.

Feedback avoidance. If it feels hard to write, it doesn't get written. Peer reviews get vague filler. Slack messages get drafted and deleted. Managers sit on observations for weeks. The skill reduces the activation energy enough that the feedback actually gets sent.

The \"how do I say this nicely\" death spiral. When someone spends 20 minutes softening a 2-sentence observation until it means nothing, the recipient can't act on it. The skill keeps feedback direct and behavioral without letting it turn into a character judgment."
estimated_impact: "Saves 15-30 min per feedback instance. For formal review cycles (360s, mid-years, end-of-years), probably 1-2 hours across 6-8 peer comments in a sitting. Harder-to-quantify impact: feedback that previously didn't get sent now does."
usage_frequency: Weekly
expected_audience: 16+ people
impact_type: [Time saved per use, Increased output volume or consistency, Other]
compatibility: [claude-chat, claude-cowork, claude-code]
tags: [feedback, performance-reviews, communication]
---

# Drafting Actionable Feedback

## Why This Matters

Most workplace feedback fails because it's vague. "Great job on the project" doesn't help someone repeat what worked. "You need to communicate better" doesn't help someone change. The difference between feedback that changes behavior and feedback that gets ignored is specificity: what happened, what was notable about it, and what effect it had.

## The Framework

Every piece of feedback follows three parts:

**What happened > What you noticed > What it did**

This applies to both positive and growth-oriented feedback. The structure is the same because the goal is the same: help the recipient understand a specific behavior and its concrete impact so they can do more of it or adjust it.

### What each part does

**What happened** is the context. A specific meeting, conversation, Slack thread, or deliverable. It grounds the feedback in something the recipient can remember and verify. Without this, feedback feels like a character judgment rather than an observation.

**What you noticed** is the behavior. Not an interpretation, not a trait, not a feeling about the person. The observable thing they did or said. This is the hardest part to get right because people naturally jump to conclusions ("you were dismissive") rather than describing what they saw ("you started responding before she finished her point").

**What it did** is the impact. What happened as a result of the behavior? Did someone disengage? Did the team align faster? Did a decision get made without the right input? Impact is what makes feedback actionable because it connects the behavior to a consequence the person cares about. Without impact, feedback is just narration.

## Writing Style Rules

**Never use em dashes.** No instances of " — " anywhere in the output. Use commas, periods, semicolons, or restructure the sentence. Em dashes are an obvious marker of AI-generated text and will undermine the user's credibility. This applies to the feedback draft, to any clarifying questions you ask, and to any framing text around the feedback. Zero em dashes.

**Write like a human colleague, not a language model.** Keep sentence structures varied and natural. Avoid formulaic constructions. Read the draft back and ask: would a real person actually type this in Slack?

**Be terse.** Every word must earn its place. If a sentence doesn't add context, behavior, or impact, cut it. Two strong sentences beat four adequate ones. The goal is something the user can paste without editing.

## How to Draft Feedback

### Step 1: Understand the situation

When the user describes what happened, identify:
- The specific context (when, where, who was involved)
- The behavior they want to address (what the person actually did or said)
- The impact (what resulted from the behavior)

If any of these are missing, ask for them. Keep your questions short and direct. Three focused questions are better than a page of prompts with bullet points and sub-bullets. Don't write an essay about why you're asking. Just ask.

The most commonly missing piece is impact. People know something bothered them or impressed them but haven't articulated why it mattered.

If the user provides a vague input like "Alex isn't pulling their weight," don't draft vague feedback. Ask: "Can you think of a specific recent example? What happened, and what was the effect on the team or the work?" Get to a concrete moment before drafting anything.

### Step 2: Draft the feedback

Write it as something the user could paste directly into Slack, an email, or a review form. Aim for 2-4 sentences. The person receiving this should be able to read it in under 30 seconds and know exactly what behavior is being referenced and why it matters.

**Positive feedback example:**
"In the migration planning session yesterday, you asked the group what concerns they had before presenting your recommendation. Two risks came up that weren't on our radar, and the final plan addressed both of them. That wouldn't have happened if you'd led with the recommendation first."

**Growth-oriented feedback example:**
"In the sprint review today, you walked through the technical implementation before explaining what problem it solves for users. The stakeholders looked lost by slide three and I don't think the business value landed. Leading with the user problem first would help the audience stay with you."

Notice what makes the impact concrete in these examples. "Two risks came up that weren't on our radar, and the final plan addressed both" is observable and specific. "The stakeholders looked lost by slide three" is something you can see. Compare that to weak impact statements like "it built confidence" or "it improved collaboration" or "it was really effective." Those are interpretations, not observations. The impact should be something a camera in the room could have captured, or something measurable in the work product.

### Principles to follow

**Be direct.** Don't hedge with "I might be wrong but..." or "I don't know if you noticed but..." The framework does the softening naturally by being specific and behavioral rather than judgmental.

**One behavior per piece of feedback.** Don't bundle three observations into one message. Each piece of feedback should address one specific moment. If there are multiple things to address, draft them separately.

**Name the impact concretely.** The impact must be observable or measurable. "The stakeholders looked confused and two of them started checking their phones" is observable. "The team shipped the fix without a second round of review" is measurable. "It improved the team dynamic" is neither. If you catch yourself writing an impact that sounds like a performance review cliché ("enhanced collaboration," "demonstrated leadership," "built confidence"), rewrite it. What actually happened? What changed? What didn't happen that would have otherwise?

**Avoid trait language.** Don't describe who the person is. Describe what they did. "You're not a good listener" is a trait judgment. "You responded to her point before she finished explaining it" is a behavior. Behaviors can change. Traits feel fixed.

**Growth-oriented feedback should include a forward-looking element.** After describing the behavior and its impact, suggest what could work differently. Make it concrete: "Leading with the user problem before the technical details would help stakeholders follow the narrative" is actionable. "Try to communicate more clearly" is not.

**Positive feedback doesn't need a suggestion.** Just name what worked and why it mattered. Don't dilute it with "and you could also improve X." Positive feedback is complete on its own.

### Step 3: Check the draft

Before presenting the feedback to the user, verify:
- Is the context specific enough that the recipient will know exactly what moment is being referenced?
- Is the behavior described as something observable (what they did/said), not an interpretation (what you think they meant/felt)?
- Is the impact concrete and connected to something observable or measurable, not an abstraction like "built confidence" or "improved collaboration"?
- Could this be pasted into Slack right now and make sense to the recipient without additional context?
- Is it 2-4 sentences? If it's longer, tighten it.
- Are there zero em dashes? Check again. Replace any with commas, periods, or semicolons.

### Tone calibration

Match the user's relationship with the recipient. Feedback to a peer you work with daily can be casual ("Hey, quick thing from today's sync..."). Feedback for a formal review should be more structured but still specific. Feedback to someone you manage can be warmer but should still be direct.

If the user doesn't specify the channel or relationship, draft it as a direct Slack message to a peer. The user can always ask you to adjust the tone.

## Delivery Guidance

After drafting the feedback, briefly help the user think about how to share it. This matters most in two situations: when the feedback is serious or could be hard to hear, and when the user doesn't have an established practice of giving open feedback with that person. Keep the guidance to 2-3 sentences, not a playbook.

**When feedback culture already exists.** If the user and recipient regularly exchange feedback, delivery is straightforward. Slack, email, or next 1:1. No special framing needed.

**When there's no established feedback relationship.** If this is the first time the user is giving this person direct feedback, suggest opening with a brief frame-set: "I noticed something in [context] and wanted to share it because I think it would be useful." This normalizes the act of giving feedback without making it feel like an ambush. Don't over-prepare the recipient or bury the feedback in disclaimers.

**When the feedback is serious or could sting.** If the behavior had significant impact (someone was publicly embarrassed, a decision went badly, trust was damaged), suggest having the conversation live rather than over text. Written feedback works for lightweight observations. For heavier topics, a short 1:1 or video call lets the recipient ask questions and hear tone. The written draft can still be useful as preparation or as a follow-up summary after the conversation.

**When the user isn't sure if they should say anything at all.** If the user is hesitating, the question isn't "is this worth saying?" It's "would the recipient benefit from knowing this?" If the answer is yes, help them find the right channel and framing. If the answer is genuinely unclear, suggest they sit on it for a day and see if it still feels important.

## Handling Edge Cases

**User is venting, not giving feedback.** If the input sounds like frustration ("Alex never listens to anyone"), acknowledge it briefly, then redirect: "That sounds frustrating. Can you think of a specific recent moment where this happened? What did Alex do, and what was the effect?" Don't write a paragraph validating their emotions. One sentence of acknowledgment, then the question.

**User wants to give feedback but is nervous.** The framework helps here. Behavioral, specific feedback is less confrontational than vague criticism. Describing what happened and what it did is much easier to receive than "you always" or "you never" statements.

**User describes a pattern, not a single instance.** Feedback is most credible when anchored to a specific example, even if it represents a pattern. Draft the feedback around the most recent or clearest instance. If the user wants to reference the pattern: "This is something I've noticed a few times. [Most recent example]. The impact is [specific]." Don't list every instance.

**User wants to give feedback up (to a manager or senior person).** Same framework, same specificity. The power dynamic doesn't change what makes feedback actionable. If the user is uncomfortable, suggest framing it as an observation and a question: "In [context], [behavior happened]. The effect was [impact]. I wanted to flag it; is there context I'm missing?"
